import { createHash } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoginAuth, passwordLogin } from '../auth/index.js';
import { escapeHtml, FailureLimiter, formActionSource, MAX_FAILURES_PER_USERNAME } from '../auth/password-login.js';
import { REFRESH_REUSE_GRACE_MS } from '../auth/provider.js';
import { createHttpHandler, requestContext } from '../http.js';

const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const REDIRECT = 'http://127.0.0.1:9999/callback';

interface Harness {
  base: string;
  mealie: {
    logins: Array<Record<string, string>>;
    deleted: string[];
    tokenValid: boolean | 'down';
    loginStatus: number;
  };
  seenTokens: Array<string | undefined>;
  close(): Promise<void>;
}

let harness: Harness;

async function listen(handler: http.RequestListener): Promise<http.Server> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}
const portOf = (s: http.Server) => (s.address() as AddressInfo).port;

async function startHarness(): Promise<Harness> {
  const mealie: Harness['mealie'] = { logins: [], deleted: [], tokenValid: true, loginStatus: 200 };
  const stub = await listen((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/api/auth/token') {
        mealie.logins.push(Object.fromEntries(new URLSearchParams(raw)));
        if (mealie.loginStatus !== 200) return json(mealie.loginStatus, { detail: 'no' });
        return json(200, { access_token: 'session-jwt', token_type: 'bearer', expires_in: 172800 });
      }
      if (req.url === '/api/users/api-tokens' && req.method === 'POST') {
        expect(req.headers.authorization).toBe('Bearer session-jwt');
        return json(201, { id: 11, name: JSON.parse(raw).name, token: 'long-lived-token' });
      }
      if (req.url === '/api/users/self') {
        if (mealie.tokenValid === 'down') return json(503, {});
        return mealie.tokenValid ? json(200, { id: 'u' }) : json(401, { detail: 'dead' });
      }
      if (req.url?.startsWith('/api/users/api-tokens/') && req.method === 'DELETE') {
        mealie.deleted.push(req.url);
        return json(200, {});
      }
      return json(404, {});
    });
  });

  const seenTokens: Array<string | undefined> = [];
  let handler: ReturnType<typeof createHttpHandler> = async () => {};
  const server = await listen((req, res) => void handler(req, res));
  const base = `http://127.0.0.1:${portOf(server)}`;
  const auth = await createLoginAuth(
    { baseUrl: base, tokenKey: 'k'.repeat(40), dataDir: ':memory:', trustProxyHops: 0 },
    `http://127.0.0.1:${portOf(stub)}`,
    [passwordLogin()],
  );
  handler = createHttpHandler({ kind: 'login', auth }, async (_req, res) => {
    seenTokens.push(requestContext.getStore()?.token);
    res.writeHead(200);
    res.end('mcp');
  });
  return {
    base,
    mealie,
    seenTokens,
    close: async () => {
      await auth.close();
      server.close();
      stub.close();
    },
  };
}

beforeEach(async () => {
  harness = await startHarness();
});
afterEach(async () => {
  vi.useRealTimers();
  await harness.close();
});

async function register(redirect = REDIRECT): Promise<Response> {
  return fetch(`${harness.base}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirect],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'Test <Client>',
    }),
  });
}

function authorizeUrl(clientId: string): string {
  const url = new URL(`${harness.base}/authorize`);
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'st',
  })) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

const flowFrom = (html: string) => /name="flow" value="([^"]+)"/.exec(html)?.[1] as string;

function submit(flow: string, password = 'pw', username = 'me@example.com'): Promise<Response> {
  return fetch(`${harness.base}/oauth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ flow, username, password }).toString(),
  });
}

function tokenRequest(fields: Record<string, string>): Promise<Response> {
  return fetch(`${harness.base}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

async function startLogin(): Promise<{ clientId: string; flow: string; page: Response; html: string }> {
  const { client_id: clientId } = (await (await register()).json()) as { client_id: string };
  const page = await fetch(authorizeUrl(clientId));
  const html = await page.text();
  return { clientId, flow: flowFrom(html), page, html };
}

async function login(): Promise<{ clientId: string; code: string }> {
  const { clientId, flow } = await startLogin();
  const res = await submit(flow);
  expect(res.status).toBe(303);
  return { clientId, code: new URL(res.headers.get('location') as string).searchParams.get('code') as string };
}

async function loginToTokens() {
  const { clientId, code } = await login();
  const res = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: VERIFIER,
    redirect_uri: REDIRECT,
  });
  expect(res.status).toBe(200);
  return {
    clientId,
    tokens: (await res.json()) as { access_token: string; refresh_token: string; expires_in: number },
  };
}

const refresh = (clientId: string, token: string) =>
  tokenRequest({ grant_type: 'refresh_token', client_id: clientId, refresh_token: token });

describe('discovery and registration', () => {
  it('publishes metadata pointing at this server', async () => {
    const meta = (await (await fetch(`${harness.base}/.well-known/oauth-protected-resource`)).json()) as Record<
      string,
      unknown
    >;
    expect(meta.resource).toBe(harness.base); // no trailing slash: Claude compares this with the typed URL
    expect(meta.authorization_servers).toEqual([`${harness.base}/`]);
    const as = (await (await fetch(`${harness.base}/.well-known/oauth-authorization-server`)).json()) as Record<
      string,
      unknown
    >;
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
  });
  it('sends security headers on the OAuth routes', async () => {
    const res = await fetch(`${harness.base}/.well-known/oauth-authorization-server`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    // A COOP header on the login flow would cut a popup-based client off from its opener.
    expect(res.headers.get('cross-origin-opener-policy')).toBeNull();
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
  it('refuses a disallowed redirect URI', async () => {
    const res = await register('https://evil.example/cb');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client_metadata' });
  });
  it('refuses userinfo tricks in a redirect URI', async () => {
    expect((await register('http://127.0.0.1:@evil.example/cb')).status).toBe(400);
  });
});

describe('login page', () => {
  it('warns clearly and sets protective headers', async () => {
    const { page, html } = await startLogin();
    expect(html).toContain('This page is not Mealie');
    expect(html).toContain(new URL(harness.base).host);
    expect(html).toContain('127.0.0.1:9999');
    expect(html).toContain('Test &#60;Client&#62;');
    expect(html).not.toContain('Test <Client>');
    const csp = page.headers.get('content-security-policy');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' http://127.0.0.1:9999");
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('cross-origin-opener-policy')).toBeNull();
  });
  it('sends the credentials to Mealie as a form', async () => {
    await login();
    expect(harness.mealie.logins).toEqual([{ username: 'me@example.com', password: 'pw' }]);
  });
  it('returns state with the code', async () => {
    const { flow } = await startLogin();
    expect(new URL((await submit(flow)).headers.get('location') as string).searchParams.get('state')).toBe('st');
  });
  it('treats the flow as single use and offers a fresh one after a failure', async () => {
    harness.mealie.loginStatus = 401;
    const { flow } = await startLogin();
    const failed = await submit(flow);
    expect(failed.status).toBe(401);
    const html = await failed.text();
    expect(html).toContain('SSO');
    expect((await submit(flow)).status).toBe(400);
    harness.mealie.loginStatus = 200;
    expect((await submit(flowFrom(html))).status).toBe(303);
  });
  it('reports a locked account distinctly', async () => {
    harness.mealie.loginStatus = 423;
    const { flow } = await startLogin();
    expect(await (await submit(flow)).text()).toContain('locked');
  });
  it('stops before Mealie would lock the account', async () => {
    harness.mealie.loginStatus = 401;
    let { flow } = await startLogin();
    for (let i = 0; i < MAX_FAILURES_PER_USERNAME; i++) flow = flowFrom(await (await submit(flow)).text());
    const throttled = await submit(flow);
    expect(throttled.status).toBe(429);
    expect(harness.mealie.logins).toHaveLength(MAX_FAILURES_PER_USERNAME);
  });
});

describe('token endpoint', () => {
  it('completes the flow and resolves to the minted Mealie token', async () => {
    const { tokens } = await loginToTokens();
    expect(tokens.access_token).toMatch(/^mcp_at_/);
    expect(tokens.expires_in).toBe(3600);
    expect(JSON.stringify(tokens)).not.toContain('long-lived-token');
    const res = await fetch(harness.base, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    expect(res.status).toBe(200);
    expect(harness.seenTokens).toEqual(['long-lived-token']);
  });
  it('rejects a wrong PKCE verifier', async () => {
    const { clientId, code } = await login();
    const res = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: 'x'.repeat(64),
    });
    expect(res.status).toBe(400);
  });
  it('rejects a replayed code', async () => {
    const { clientId, code } = await login();
    const body = { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER };
    expect((await tokenRequest(body)).status).toBe(200);
    expect(await (await tokenRequest(body)).json()).toMatchObject({ error: 'invalid_grant' });
  });
  it('rejects a mismatched redirect URI', async () => {
    const { clientId, code } = await login();
    const res = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: VERIFIER,
      redirect_uri: 'http://127.0.0.1:1/other',
    });
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
  });
  it('rejects a foreign resource', async () => {
    const { clientId, code } = await login();
    const res = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: VERIFIER,
      resource: 'https://other.example/',
    });
    expect(await res.json()).toMatchObject({ error: 'invalid_target' });
  });
});

describe('refresh', () => {
  it('rotates tokens, and accepts the old one briefly', async () => {
    const { clientId, tokens } = await loginToTokens();
    const next = (await (await refresh(clientId, tokens.refresh_token)).json()) as {
      refresh_token: string;
      access_token: string;
    };
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await refresh(clientId, tokens.refresh_token)).status).toBe(200); // lost-response retry
  });
  it('revokes the whole grant on reuse after the grace period', async () => {
    const { clientId, tokens } = await loginToTokens();
    const next = (await (await refresh(clientId, tokens.refresh_token)).json()) as {
      refresh_token: string;
      access_token: string;
    };
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + REFRESH_REUSE_GRACE_MS + 1000);
    expect(await (await refresh(clientId, tokens.refresh_token)).json()).toMatchObject({ error: 'invalid_grant' });
    vi.restoreAllMocks();
    expect((await refresh(clientId, next.refresh_token)).status).toBe(400);
    expect(harness.mealie.deleted).toEqual(['/api/users/api-tokens/11']);
  });
  it('forces a new login when Mealie says the token is dead', async () => {
    const { clientId, tokens } = await loginToTokens();
    harness.mealie.tokenValid = false;
    expect(await (await refresh(clientId, tokens.refresh_token)).json()).toMatchObject({ error: 'invalid_grant' });
  });
  it('keeps the login through a Mealie outage', async () => {
    const { clientId, tokens } = await loginToTokens();
    harness.mealie.tokenValid = 'down';
    const during = await refresh(clientId, tokens.refresh_token);
    expect(during.status).toBe(500);
    harness.mealie.tokenValid = true;
    expect((await refresh(clientId, tokens.refresh_token)).status).toBe(200);
  });
  it('refuses a token from another client, and an access token as refresh', async () => {
    const { clientId, tokens } = await loginToTokens();
    const { client_id: other } = (await (await register()).json()) as { client_id: string };
    expect((await refresh(other, tokens.refresh_token)).status).toBe(400);
    expect((await refresh(clientId, tokens.access_token)).status).toBe(400);
  });
});

describe('revocation', () => {
  it('ends the grant and deletes the Mealie token', async () => {
    const { clientId, tokens } = await loginToTokens();
    const res = await fetch(`${harness.base}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, token: tokens.refresh_token }).toString(),
    });
    expect(res.status).toBe(200);
    expect(harness.mealie.deleted).toEqual(['/api/users/api-tokens/11']);
    expect((await fetch(harness.base, { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status).toBe(
      401,
    );
  });
});

describe('helpers', () => {
  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe('&#60;a href=&#34;x&#34;&#62;&#39;&#38;');
  });
  it('builds a form-action source for custom schemes', () => {
    expect(formActionSource('cursor://anysphere/cb')).toBe('cursor:');
    expect(formActionSource('https://claude.ai/api/mcp/auth_callback')).toBe('https://claude.ai');
  });
  it('limits within a window and forgets after it', () => {
    let now = 0;
    const limiter = new FailureLimiter(2, 100, () => now);
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(false);
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(true);
    now = 101;
    expect(limiter.isBlocked('a')).toBe(false);
  });
});
