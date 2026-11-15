import { randomBytes, randomUUID } from 'node:crypto';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTargetError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Response } from 'express';
import type { LoginMethod, PendingFlow } from './login-method.js';
import { type MealieSessionApi, MealieUnavailableError } from './mealie-session.js';
import { isRedirectUriAllowed } from './redirects.js';
import { REFRESH_TOKEN_PREFIX, type TokenPair, type TokenStore } from './store.js';

const FLOW_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
export const MAX_PENDING_FLOWS = 1000;
/** A retried refresh whose response got lost still works for this long; later reuse looks like theft. */
export const REFRESH_REUSE_GRACE_MS = 60 * 1000;
/** A grant with no tokens yet may belong to a login still between code issue and exchange. */
const ABANDONED_GRANT_MIN_AGE_MS = 5 * 60 * 1000;

interface AuthorizationCode {
  clientId: string;
  grantId: string;
  challenge: string;
  redirectUri: string;
  createdAt: number;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function toOAuthTokens(pair: TokenPair): OAuthTokens {
  return {
    access_token: pair.accessToken,
    token_type: 'bearer',
    expires_in: pair.expiresInSeconds,
    refresh_token: pair.refreshToken,
  };
}

export class MealieOAuthProvider implements OAuthServerProvider {
  private readonly flows = new Map<string, PendingFlow>();
  private readonly codes = new Map<string, AuthorizationCode>();

  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(
    private readonly store: TokenStore,
    private readonly mealie: MealieSessionApi,
    private readonly loginMethods: LoginMethod[],
    private readonly baseUrl: string,
    /** Stop waiting for Mealie's token check after this long during a refresh; 0 always waits. */
    private readonly refreshCheckTimeoutMs = 0,
    private readonly now: () => number = () => Date.now(),
    private readonly log: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  ) {
    this.clientsStore = {
      getClient: (clientId) => store.getClient(clientId),
      registerClient: (client) => {
        if (client.redirect_uris.some((uri) => !isRedirectUriAllowed(String(uri)))) {
          throw new InvalidClientMetadataError(
            "redirect_uri is not allowed. Loopback addresses and Claude's hosted callback are allowed by default; add any other prefix to MCP_ALLOWED_REDIRECT_PREFIXES.",
          );
        }
        const full = {
          ...client,
          client_id: randomUUID(),
          client_id_issued_at: Math.floor(this.now() / 1000),
        } as OAuthClientInformationFull;
        store.saveClient(full);
        return full;
      },
    };
  }

  private addFlow(flow: Omit<PendingFlow, 'id' | 'createdAt'>): PendingFlow {
    this.evict();
    // The route is unauthenticated, so the map is capped: the oldest flow goes, new logins keep working.
    if (this.flows.size >= MAX_PENDING_FLOWS) {
      const oldest = this.flows.keys().next().value;
      if (oldest !== undefined) this.flows.delete(oldest);
    }
    const entry: PendingFlow = { ...flow, id: randomBytes(32).toString('base64url'), createdAt: this.now() };
    this.flows.set(entry.id, entry);
    return entry;
  }

  private evict(): void {
    const now = this.now();
    for (const [id, flow] of this.flows) if (now - flow.createdAt > FLOW_TTL_MS) this.flows.delete(id);
    for (const [code, entry] of this.codes) if (now - entry.createdAt > CODE_TTL_MS) this.codes.delete(code);
  }

  takeFlow(id: string): PendingFlow | undefined {
    this.evict();
    const flow = this.flows.get(id);
    this.flows.delete(id);
    return flow;
  }

  renewFlow(flow: PendingFlow): PendingFlow {
    return this.addFlow({ client: flow.client, params: flow.params });
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (params.resource && !this.isOwnResource(params.resource)) {
      throw new InvalidTargetError('This token is not for this server.');
    }
    // One method today. With several, this becomes a chooser page.
    this.loginMethods[0].begin(this.addFlow({ client, params }), res);
  }

  /** Accepts this server's origin and paths under it, since the MCP endpoint answers on any path. */
  private isOwnResource(resource: URL): boolean {
    return resource.origin === new URL(this.baseUrl).origin;
  }

  async completeLogin(flow: PendingFlow, sessionJwt: string, res: Response): Promise<void> {
    const minted = await this.mealie.mintToken(sessionJwt);
    const grantId = this.store.createGrant({
      clientId: flow.client.client_id,
      mealieToken: minted.token,
      mealieTokenId: minted.id,
      resource: this.baseUrl,
    });
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, {
      clientId: flow.client.client_id,
      grantId,
      challenge: flow.params.codeChallenge,
      redirectUri: flow.params.redirectUri,
      createdAt: this.now(),
    });
    const target = new URL(flow.params.redirectUri);
    target.searchParams.set('code', code);
    if (flow.params.state !== undefined) target.searchParams.set('state', flow.params.state);
    res.redirect(303, target.toString());
  }

  private liveCode(client: OAuthClientInformationFull, code: string): AuthorizationCode {
    this.evict();
    const entry = this.codes.get(code);
    if (!entry || entry.clientId !== client.client_id) throw new InvalidGrantError('Invalid authorization code');
    return entry;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return this.liveCode(client, code).challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const entry = this.liveCode(client, code);
    this.codes.delete(code); // single use, even when a check below fails
    if (redirectUri !== undefined && redirectUri !== entry.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }
    if (resource && !this.isOwnResource(resource)) throw new InvalidTargetError('This token is not for this server.');
    return toOAuthTokens(this.store.issueTokens(entry.grantId));
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    if (resource && !this.isOwnResource(resource)) throw new InvalidTargetError('This token is not for this server.');
    const record = refreshToken.startsWith(REFRESH_TOKEN_PREFIX) ? this.store.findToken(refreshToken) : undefined;
    if (record?.kind !== 'refresh' || record.expiresAt <= this.now()) {
      this.log(`refresh: rejected an ${record ? 'expired' : 'unknown'} refresh token`);
      throw new InvalidGrantError('Invalid refresh token');
    }
    const grant = this.store.getGrant(record.grantId);
    if (!grant || grant.clientId !== client.client_id) throw new InvalidGrantError('Invalid refresh token');

    const started = this.now();
    const tag = `grant=${grant.id.slice(0, 8)}`;
    const sinceRotation = record.supersededAt === null ? null : started - record.supersededAt;
    if (sinceRotation !== null && sinceRotation > REFRESH_REUSE_GRACE_MS) {
      this.log(`refresh: ${tag} reused ${seconds(sinceRotation)} after rotation; ending the login`);
      await this.endGrant(grant.id, grant.mealieToken, grant.mealieTokenId);
      throw new InvalidGrantError('Refresh token was already used');
    }

    const check = this.mealie.isTokenValid(grant.mealieToken);
    let valid: boolean | 'pending';
    try {
      valid = await this.withCheckTimeout(check);
    } catch (err) {
      // A Mealie outage must not cost anyone their login: invalid_grant would force a new one.
      if (err instanceof MealieUnavailableError) {
        this.log(`refresh: ${tag} Mealie unavailable after ${seconds(this.now() - started)}; login kept`);
        throw new ServerError('Mealie is unavailable, try again later');
      }
      throw err;
    }
    const checked =
      valid === 'pending'
        ? `Mealie check still running after ${seconds(this.now() - started)}, answered without it`
        : `Mealie check ${seconds(this.now() - started)}`;
    if (valid === 'pending') {
      // Opt-in: a slow host must not hold the client's token response open. The verdict still counts when it
      // arrives; until then the new tokens work, as they would if the token were revoked just after a check.
      check.then(
        (ok) => {
          if (ok) return;
          this.log(`refresh: ${tag} Mealie token was revoked (late answer); ending the login`);
          this.store.deleteGrant(grant.id);
        },
        () => {}, // unreachable Mealie keeps the login, as above
      );
    } else if (!valid) {
      this.log(`refresh: ${tag} Mealie token was revoked; ending the login`);
      this.store.deleteGrant(grant.id);
      throw new InvalidGrantError('The Mealie token behind this login was revoked');
    }

    const pair = this.store.issueTokens(grant.id, refreshToken);
    const kind = sinceRotation === null ? 'rotated' : `retried ${seconds(sinceRotation)} after rotation; reissued`;
    this.log(`refresh: ${tag} ${kind} (${checked})`);
    return toOAuthTokens(pair);
  }

  /** The check's answer, or 'pending' once the configured timeout passes first. Without a timeout, waits. */
  private async withCheckTimeout(check: Promise<boolean>): Promise<boolean | 'pending'> {
    if (this.refreshCheckTimeoutMs <= 0) return check;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'pending'>((resolve) => {
      timer = setTimeout(() => resolve('pending'), this.refreshCheckTimeoutMs);
    });
    try {
      return await Promise.race([check, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const resolved = this.store.resolveAccessToken(token);
    if (!resolved) throw new InvalidGrantError('Invalid access token');
    return {
      token,
      clientId: resolved.grant.clientId,
      scopes: [],
      expiresAt: Math.floor(resolved.expiresAt / 1000),
      resource: new URL(resolved.grant.resource),
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const record = this.store.findToken(request.token);
    if (!record) return;
    const grant = this.store.getGrant(record.grantId);
    if (!grant || grant.clientId !== client.client_id) return;
    await this.endGrant(grant.id, grant.mealieToken, grant.mealieTokenId);
  }

  /** Removes the local grant whatever Mealie says; the leftover token row is visible in the user's profile. */
  private async endGrant(grantId: string, mealieToken: string, mealieTokenId: number): Promise<void> {
    this.store.deleteGrant(grantId);
    await this.mealie.deleteToken(mealieToken, mealieTokenId).catch(() => false);
  }

  /** Drops expired tokens and abandoned grants. A grant is kept for the next run if Mealie can't be reached. */
  async purge(): Promise<void> {
    this.store.deleteExpiredTokens();
    for (const grant of this.store.findAbandonedGrants(ABANDONED_GRANT_MIN_AGE_MS)) {
      const removed = await this.mealie.deleteToken(grant.mealieToken, grant.mealieTokenId).catch(() => false);
      if (removed) this.store.deleteGrant(grant.id);
    }
  }
}
