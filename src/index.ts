#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type ParsedArgs, parseArgs } from './args.js';
import { MealieClient } from './client.js';
import { ConfigError, parseFlag, resolveHttpMode, startupWarnings } from './config.js';
import { type HttpAuth, requestContext, startHttpServer } from './http.js';
import { createServer } from './server.js';

function fail(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

let parsed: ParsedArgs;
try {
  parsed = parseArgs(process.argv.slice(2));
} catch (err) {
  fail((err as Error).message);
}

const { transport, host, port, portWasExplicit, filterOptions } = parsed;
const url = process.env.MEALIE_URL;

if (!url) fail('MEALIE_URL environment variable is required. See .env.example for configuration instructions.');

async function runHttp(mealieUrl: string): Promise<void> {
  let close = async (): Promise<void> => {};
  let keepPort = portWasExplicit;
  let mode: HttpAuth;
  try {
    const resolved = resolveHttpMode(process.env, host, port);
    for (const warning of startupWarnings(resolved, host)) process.stderr.write(`${warning}\n`);
    if (resolved.kind === 'login') {
      // Loaded only here: non-login modes never touch SQLite or Express.
      const { createLoginAuth, passwordLogin } = await import('./auth/index.js');
      const auth = await createLoginAuth(resolved.config, mealieUrl, [passwordLogin()]);
      close = auth.close;
      mode = { kind: 'login', auth };
      keepPort = true; // the OAuth issuer URL contains the port, so it must not drift
    } else {
      mode = resolved;
    }
  } catch (err) {
    if (err instanceof ConfigError) fail(err.message);
    throw err;
  }

  const client = new MealieClient(mealieUrl, () => {
    const store = requestContext.getStore();
    if (!store) throw new Error('No request context — the token was not set before this call');
    return store.token;
  });
  const httpServer = await startHttpServer(() => createServer(client, filterOptions), host, port, keepPort, mode);

  // PID 1 in a container ignores SIGTERM without a handler, which would make every `docker stop` wait out its timeout.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      httpServer.close();
      httpServer.closeIdleConnections();
      void close().finally(() => process.exit(0));
    });
  }
}

if (transport === 'http') {
  await runHttp(url);
} else {
  const token = process.env.MEALIE_API_TOKEN;
  if (!token) fail('MEALIE_API_TOKEN environment variable is required for stdio transport.');
  try {
    if (parseFlag('MEALIE_MCP_PASSWORD_LOGIN', process.env.MEALIE_MCP_PASSWORD_LOGIN)) {
      process.stderr.write(
        'Note: MEALIE_MCP_PASSWORD_LOGIN only applies to --transport http; ignoring it over stdio.\n',
      );
    }
  } catch (err) {
    fail((err as Error).message);
  }
  const server = createServer(new MealieClient(url, token), filterOptions);
  await server.connect(new StdioServerTransport());
}
