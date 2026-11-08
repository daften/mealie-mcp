import { AsyncLocalStorage } from 'node:async_hooks';
import * as http from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

interface RequestContext {
  token: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

// MCP request bodies carry JSON-RPC messages. The largest legitimate one is an image or asset upload, whose
// base64 payload is ~4/3 the file size, so 16 MiB admits files up to roughly 12 MB.
export const MCP_MAX_BODY_BYTES = 16 * 1024 * 1024;

export class PayloadTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Request body exceeds the ${limit}-byte limit.`);
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Reads a request body into memory, refusing anything over `maxBytes`. Every unauthenticated route
 * that reads a body goes through here: an unbounded read let one oversized POST either exhaust
 * memory or, past V8's maximum string length, throw inside the stream listener and kill the process.
 * Chunks are kept as Buffers and decoded once at the end, so a multi-byte UTF-8 character split
 * across two chunks is not mangled.
 */
export function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const declared = Number(req.headers?.['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new PayloadTooLargeError(maxBytes));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return; // over the limit: drop the rest; the 413 closes the connection
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        chunks.length = 0;
        reject(new PayloadTooLargeError(maxBytes));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/** 413 response for {@link PayloadTooLargeError}. `Connection: close` stops Node reading the rest. */
function rejectTooLarge(res: http.ServerResponse, err: PayloadTooLargeError, jsonRpc: boolean): void {
  const body = jsonRpc
    ? { jsonrpc: '2.0', error: { code: -32600, message: err.message }, id: null }
    : { error: 'invalid_request', error_description: err.message };
  res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
  res.end(JSON.stringify(body));
}

/** What the HTTP layer needs from the login stack, so that non-login modes never load it. */
export interface LoginAuth {
  baseUrl: string;
  isAuthPath(pathname: string): boolean;
  handle(req: http.IncomingMessage, res: http.ServerResponse): void;
  /** The caller's Mealie token, or null when the bearer isn't a live token from the store. */
  resolveBearer(bearer: string): string | null;
}

export type HttpAuth =
  | { kind: 'per-caller' }
  | { kind: 'server-key'; token: string }
  | { kind: 'login'; auth: LoginAuth };

// Paths the login stack serves. Outside login mode they 404 instead of falling through to the bearer check.
export const AUTH_PATHS = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/authorize',
  '/token',
  '/register',
  '/revoke',
  '/oauth/login',
];

function unauthorized(res: http.ServerResponse, challenge: string, description: string): void {
  res.writeHead(401, { 'WWW-Authenticate': challenge, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'unauthorized', error_description: description }));
}

export function createHttpHandler(
  mode: HttpAuth,
  mcpHandler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>,
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    // Liveness probe: no auth and mode-agnostic, so container health doesn't depend on the auth surface.
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' }));
      return;
    }

    if (mode.kind === 'login' && mode.auth.isAuthPath(pathname)) {
      mode.auth.handle(req, res);
      return;
    }
    if (mode.kind !== 'login' && AUTH_PATHS.includes(pathname)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', error_description: 'Login is not enabled on this server.' }));
      return;
    }

    if (mode.kind === 'server-key') {
      // Deliberately ignores any Authorization header: this mode has exactly one identity.
      await requestContext.run({ token: mode.token }, () => mcpHandler(req, res));
      return;
    }

    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;

    if (mode.kind === 'login') {
      const metadata = `resource_metadata="${mode.auth.baseUrl}/.well-known/oauth-protected-resource"`;
      if (!bearer) {
        unauthorized(res, `Bearer ${metadata}`, 'Log in to use this server.');
        return;
      }
      const token = mode.auth.resolveBearer(bearer);
      if (!token) {
        // Also the answer for a raw Mealie API key: login mode never forwards one.
        unauthorized(res, `Bearer error="invalid_token", ${metadata}`, 'The access token is invalid or expired.');
        return;
      }
      await requestContext.run({ token }, () => mcpHandler(req, res));
      return;
    }

    if (!bearer) {
      unauthorized(res, 'Bearer', 'Send your Mealie API token as a Bearer token.');
      return;
    }
    await requestContext.run({ token: bearer }, () => mcpHandler(req, res));
  };
}

/**
 * Serves one MCP request. Stateless HTTP transport requires a fresh transport + server per request
 * (the WebStandardStreamableHTTPServerTransport throws if reused across requests).
 *
 * The body is read here, under {@link MCP_MAX_BODY_BYTES}, and handed to the SDK pre-parsed, because
 * the SDK buffers whatever arrives with no limit of its own. That matters even behind the Bearer
 * guard: the guard only checks that *a* Bearer token is present (Mealie validates it later), so
 * without this cap any caller could make the server hold an arbitrarily large body in memory.
 */
export function createMcpRequestHandler(
  createMcpServer: () => McpServer,
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return async (req, res) => {
    let parsedBody: unknown;
    if (req.method === 'POST') {
      let raw: string;
      try {
        raw = await readBody(req, MCP_MAX_BODY_BYTES);
      } catch (err) {
        if (!(err instanceof PayloadTooLargeError)) throw err;
        rejectTooLarge(res, err, true);
        return;
      }
      try {
        parsedBody = JSON.parse(raw);
      } catch {
        // Same response the SDK itself sends for an unparseable body.
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null }),
        );
        return;
      }
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  };
}

export function classifyHost(host: string): 'loopback' | 'non-loopback' {
  return ['127.0.0.1', '::1', 'localhost'].includes(host) ? 'loopback' : 'non-loopback';
}

export async function tryListen(httpServer: http.Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });
}

export async function startHttpServer(
  createMcpServer: () => McpServer,
  host: string,
  requestedPort: number,
  portWasExplicit: boolean,
  mode: HttpAuth,
  tryListenFn: (server: http.Server, host: string, port: number) => Promise<void> = tryListen,
): Promise<http.Server> {
  const handler = createHttpHandler(mode, createMcpRequestHandler(createMcpServer));

  const httpServer = http.createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      process.stderr.write(`HTTP request handler error: ${err}\n`);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal server error');
      }
    }
  });

  let port = requestedPort;
  let moved = false;

  while (true) {
    try {
      await tryListenFn(httpServer, host, port);
      break;
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code !== 'EADDRINUSE') {
        throw err;
      }
      if (portWasExplicit) {
        process.stderr.write(
          `Error: Port ${port} on ${host} is already in use. Choose a different port with --port.\n`,
        );
        process.exit(1);
      }
      const attempted = port - requestedPort;
      if (attempted >= 10) {
        process.stderr.write(
          `Error: Ports ${requestedPort}–${requestedPort + 10} on ${host} are all in use. Specify an available port with --port.\n`,
        );
        process.exit(1);
      }
      port++;
      moved = true;
    }
  }

  httpServer.on('error', (err) => {
    process.stderr.write(`HTTP server error: ${err}\n`);
  });

  process.stdout.write(`MCP server for Mealie listening on http://${host}:${port}\n`);
  if (moved) {
    process.stdout.write(`(port ${requestedPort} was in use — moved up automatically)\n`);
  }

  return httpServer;
}
