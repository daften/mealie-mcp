import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHttpHandler,
  type HttpAuth,
  type LoginAuth,
  MCP_MAX_BODY_BYTES,
  PayloadTooLargeError,
  readBody,
  requestContext,
} from '../http.js';

let server: http.Server | undefined;
afterEach(() => server?.close());

async function serve(mode: HttpAuth): Promise<{ url: string; seen: Array<string | undefined> }> {
  const seen: Array<string | undefined> = [];
  const handler = createHttpHandler(mode, async (_req, res) => {
    seen.push(requestContext.getStore()?.token);
    res.writeHead(200);
    res.end('mcp');
  });
  server = http.createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

function fakeLogin(): LoginAuth & { handle: ReturnType<typeof vi.fn> } {
  return {
    baseUrl: 'https://mcp.example.com',
    isAuthPath: (p) => p === '/authorize',
    handle: vi.fn((_req, res: http.ServerResponse) => {
      res.writeHead(200);
      res.end('auth');
    }),
    resolveBearer: (b) => (b === 'mcp_at_good' ? 'mealie-token' : null),
  };
}

describe('per-caller mode', () => {
  it('forwards each caller their own token', async () => {
    const { url, seen } = await serve({ kind: 'per-caller' });
    await fetch(url, bearer('alice'));
    await fetch(url, bearer('bob'));
    expect(seen).toEqual(['alice', 'bob']);
  });
  it('answers 401 with a bare challenge when no token is sent', async () => {
    const { url } = await serve({ kind: 'per-caller' });
    const res = await fetch(url);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });
  it('404s the auth surface', async () => {
    const { url } = await serve({ kind: 'per-caller' });
    for (const p of ['/authorize', '/token', '/.well-known/oauth-protected-resource', '/oauth/login']) {
      expect((await fetch(url + p)).status).toBe(404);
    }
  });
});

describe('server-key mode', () => {
  it('uses the server key with or without a bearer', async () => {
    const { url, seen } = await serve({ kind: 'server-key', token: 'shared' });
    expect((await fetch(url)).status).toBe(200);
    await fetch(url, bearer('someone-else'));
    expect(seen).toEqual(['shared', 'shared']);
  });
});

describe('login mode', () => {
  it('resolves a store token to the Mealie token', async () => {
    const { url, seen } = await serve({ kind: 'login', auth: fakeLogin() });
    expect((await fetch(url, bearer('mcp_at_good'))).status).toBe(200);
    expect(seen).toEqual(['mealie-token']);
  });
  it('rejects a Mealie API key, never forwarding it', async () => {
    const { url, seen } = await serve({ kind: 'login', auth: fakeLogin() });
    const res = await fetch(url, bearer('eyJ.a.real.mealie.key'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(seen).toEqual([]);
  });
  it('points an anonymous caller at the metadata document', async () => {
    const { url } = await serve({ kind: 'login', auth: fakeLogin() });
    expect((await fetch(url)).headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
    );
  });
  it('routes auth paths to the login stack, including with a query string', async () => {
    const auth = fakeLogin();
    const { url } = await serve({ kind: 'login', auth });
    expect(await (await fetch(`${url}/authorize?x=1`)).text()).toBe('auth');
    expect(auth.handle).toHaveBeenCalledOnce();
  });
});

describe('health and limits', () => {
  it.each([{ kind: 'per-caller' }, { kind: 'server-key', token: 't' }] as HttpAuth[])(
    'serves /health unauthenticated in $kind',
    async (mode) => {
      const { url } = await serve(mode);
      expect((await fetch(`${url}/health`)).status).toBe(200);
    },
  );
  it('refuses a body over the limit by declared length', async () => {
    const req = Object.assign(new http.IncomingMessage(null as never), {
      headers: { 'content-length': String(MCP_MAX_BODY_BYTES + 1) },
    });
    await expect(readBody(req, MCP_MAX_BODY_BYTES)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });
});
