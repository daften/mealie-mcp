import type { QueryParams } from './types.js';

export class MealieError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`Mealie API error ${status} at ${url.split('?')[0]}: ${body}`);
    this.name = 'MealieError';
  }
}

/** FastAPI answers validation failures with `detail: [{loc, msg}]` and most other errors with `detail: string`. */
function parseDetail(body: string): string | null {
  try {
    const { detail } = JSON.parse(body) as { detail?: unknown };
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      return (detail as Array<{ loc?: unknown[]; msg?: string }>)
        .map((d) => `${(d.loc ?? []).filter((part) => part !== 'body').join('.')} — ${d.msg ?? 'invalid'}`)
        .join('; ');
    }
    if (detail && typeof detail === 'object' && 'message' in detail) return String(detail.message);
  } catch {
    // not JSON: fall through
  }
  return null;
}

/**
 * Refuses an API path that could address something other than what it spells out. Tool arguments end
 * up in these paths, and `new URL()` resolves dot segments (also percent-encoded ones) before the
 * request is sent, so an ID of `../budgets/5` turned DELETE /accounts/{id} into DELETE /budgets/5,
 * and enough `../` left /api entirely with the token attached. `?` and `#` would smuggle in a
 * query or cut the path short; a backslash is treated as a slash by URL parsers.
 */
export function assertSafeApiPath(path: string): void {
  const segments = path.split('/');
  // Control characters matter as well: URL parsers silently strip tabs and newlines, so `.\n.` would
  // pass the segment check below and still be resolved as `..`.
  const hasControlCharacter = [...path].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
  const unsafe =
    !path.startsWith('/') ||
    hasControlCharacter ||
    /[?#\\]/.test(path) ||
    segments.some((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return true; // malformed percent-encoding
      }
      return decoded === '.' || decoded === '..';
    });
  if (unsafe) throw new Error(`Refusing to call an unsafe Mealie API path: ${JSON.stringify(path)}`);
}

export function formatError(err: unknown): string {
  if (err instanceof MealieError) {
    const detail = parseDetail(err.body);
    if (err.status === 400) return detail ? `Bad request: ${detail}` : 'Bad request — check your input parameters.';
    // Worded for every mode: stdio and server-key use MEALIE_API_TOKEN, per-caller HTTP forwards the
    // caller's own key, and login mode holds a token minted at login.
    if (err.status === 401) {
      return 'Authentication failed: Mealie rejected the token. Check MEALIE_API_TOKEN or the Bearer token your MCP client sends, or log in again.';
    }
    if (err.status === 403) return detail ? `Forbidden: ${detail}` : 'Your Mealie account may not do this.';
    if (err.status === 404) return 'Resource not found.';
    if (err.status >= 300 && err.status < 400) {
      return 'Mealie redirected the request instead of answering it. Check that MEALIE_URL points at Mealie itself (not a login page or proxy).';
    }
    if (err.status === 422) return detail ? `Validation failed: ${detail}` : 'Invalid request parameters.';
    if (err.status >= 500) return 'Mealie server error. Try again later.';
    return `API error ${err.status}.`;
  }
  if (err instanceof Error) return err.message;
  return 'An unknown error occurred.';
}

export class MealieClient {
  private readonly baseUrl: string;
  private readonly timeoutMs = 30_000;

  constructor(
    baseUrl: string,
    private readonly tokenResolver: string | (() => string),
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private getToken(): string {
    return typeof this.tokenResolver === 'function' ? this.tokenResolver() : this.tokenResolver;
  }

  private buildUrl(path: string, params?: QueryParams): string {
    assertSafeApiPath(path);
    const url = new URL(`${this.baseUrl}/api${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) url.searchParams.append(key, String(v));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  /**
   * Performs one request and reads its body under a single timeout. The timer must stay armed
   * until `read` finishes: `fetch` resolves as soon as the response headers arrive, so a timer
   * cleared at that point left a stalled body able to hang the tool call indefinitely.
   */
  private async send<T>(url: string, init: RequestInit, read: (response: Response) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // Never follow redirects: an API route only redirects when something is wrong (a proxy login page,
      // for example), and following it would hand that page back as if it were the result.
      const response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
      if (!response.ok) {
        const responseBody = await response.text().catch(() => '');
        throw new MealieError(response.status, url, responseBody);
      }
      return await read(response);
    } catch (err) {
      if (!(err instanceof MealieError) && controller.signal.aborted) {
        // Query strings can carry search terms; keep them out of the message (as MealieError does).
        throw new Error(`Request to ${url.split('?')[0]} timed out after ${this.timeoutMs}ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    return this.send(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.getToken()}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      async (response) => (response.status === 204 ? (undefined as T) : ((await response.json()) as T)),
    );
  }

  async get<T = unknown>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>('GET', this.buildUrl(path, params));
  }

  async post<T = unknown>(path: string, body: unknown, params?: QueryParams): Promise<T> {
    return this.request<T>('POST', this.buildUrl(path, params), body);
  }

  async put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', this.buildUrl(path), body);
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', this.buildUrl(path), body);
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', this.buildUrl(path));
  }

  /** Multipart upload. The boundary comes from FormData, so Content-Type must not be set by hand. */
  async sendForm<T = unknown>(method: 'POST' | 'PUT', path: string, form: FormData): Promise<T> {
    return this.send(
      this.buildUrl(path),
      {
        method,
        headers: { Authorization: `Bearer ${this.getToken()}`, Accept: 'application/json' },
        body: form,
      },
      async (response) => (response.status === 204 ? (undefined as T) : ((await response.json()) as T)),
    );
  }
}
