import { randomBytes } from 'node:crypto';

const TIMEOUT_MS = 30_000;

export type LoginResult = { status: 'ok'; sessionJwt: string } | { status: 'invalid' } | { status: 'locked' };

/** Mealie answered in a way that says nothing about the credentials. Never treated as a failed login. */
export class MealieUnavailableError extends Error {}

/** The handful of Mealie auth calls the login stack makes, separate from the tool-facing MealieClient. */
export class MealieSessionApi {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/api${path}`, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Deliberately omits the cause detail: the request body of /auth/token holds a password.
      throw new MealieUnavailableError(`Could not reach Mealie: ${(err as Error).name}`);
    }
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const response = await this.call('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ username, password }).toString(),
    });
    if (response.status === 401) return { status: 'invalid' };
    if (response.status === 423) return { status: 'locked' };
    if (!response.ok) throw new MealieUnavailableError(`Mealie answered ${response.status} to the login request`);
    const body = (await response.json()) as { access_token?: string };
    if (!body.access_token) throw new MealieUnavailableError('Mealie returned no access token');
    return { status: 'ok', sessionJwt: body.access_token };
  }

  /** A random suffix keeps names distinct, so repeat logins on one day stay separate rows in the profile page. */
  async mintToken(sessionJwt: string): Promise<{ token: string; id: number }> {
    const name = `mealie-mcp ${new Date().toISOString().slice(0, 10)} ${randomBytes(3).toString('hex')}`;
    const response = await this.call('/users/api-tokens', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionJwt}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) throw new MealieUnavailableError(`Mealie answered ${response.status} when creating a token`);
    const body = (await response.json()) as { token?: string; id?: number };
    if (!body.token || typeof body.id !== 'number') throw new MealieUnavailableError('Mealie returned no API token');
    return { token: body.token, id: body.id };
  }

  /** False only when Mealie says the token is dead. An outage throws, so it can't log anyone out. */
  async isTokenValid(token: string): Promise<boolean> {
    const response = await this.call('/users/self', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (response.status === 401) return false;
    if (!response.ok) throw new MealieUnavailableError(`Mealie answered ${response.status} when checking a token`);
    return true;
  }

  /** True when the token no longer exists afterwards, including when it was already gone. */
  async deleteToken(token: string, id: number): Promise<boolean> {
    const response = await this.call(`/users/api-tokens/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    return response.ok || response.status === 401 || response.status === 404;
  }
}
