import type * as http from 'node:http';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import express from 'express';
import type { LoginAuth } from '../http.js';
import type { LoginContext, LoginMethod } from './login-method.js';
import { MealieSessionApi } from './mealie-session.js';
import { MealieOAuthProvider } from './provider.js';
import { TokenStore } from './store.js';

export { passwordLogin } from './password-login.js';

export interface LoginConfig {
  baseUrl: string;
  tokenKey: string;
  dataDir: string;
  trustProxyHops: number;
}

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

const OAUTH_PATHS = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/authorize',
  '/token',
  '/register',
  '/revoke',
];

export async function createLoginAuth(
  config: LoginConfig,
  mealieUrl: string,
  methods: LoginMethod[],
): Promise<LoginAuth & { close(): Promise<void>; provider: MealieOAuthProvider }> {
  const store = await TokenStore.open(config.dataDir, config.tokenKey);
  const provider = new MealieOAuthProvider(store, new MealieSessionApi(mealieUrl), methods, config.baseUrl);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);

  // express-rate-limit logs a validation error when it sees X-Forwarded-For and trust proxy is off.
  // The per-route limits still apply; the check would only add noise behind a reverse proxy.
  const rateLimit = { validate: false };
  const baseUrl = new URL(config.baseUrl);
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: baseUrl,
      resourceServerUrl: baseUrl,
      resourceName: 'Mealie MCP',
      authorizationOptions: { rateLimit },
      tokenOptions: { rateLimit },
      revocationOptions: { rateLimit },
      // The default 30-day secret expiry would force confidential clients to log in again.
      clientRegistrationOptions: { rateLimit, clientIdGeneration: false, clientSecretExpirySeconds: 0 },
    }),
  );

  const context: LoginContext = {
    baseUrl: config.baseUrl,
    mealieUrl,
    takeFlow: (id) => provider.takeFlow(id),
    renewFlow: (flow) => provider.renewFlow(flow),
    completeLogin: (flow, jwt, res) => provider.completeLogin(flow, jwt, res),
    clientIp: (req) => req.ip ?? 'unknown',
  };
  for (const method of methods) method.register(app, context);

  const authPaths = new Set([...OAUTH_PATHS, ...methods.flatMap((m) => m.paths)]);

  const purge = () => {
    provider.purge().catch((err) => process.stderr.write(`Token cleanup failed: ${err}\n`));
  };
  purge();
  const timer = setInterval(purge, PURGE_INTERVAL_MS).unref();

  return {
    baseUrl: config.baseUrl,
    provider,
    isAuthPath: (pathname) => authPaths.has(pathname),
    handle: (req: http.IncomingMessage, res: http.ServerResponse) => {
      app(req as express.Request, res as express.Response);
    },
    resolveBearer: (bearer) => store.resolveAccessToken(bearer)?.grant.mealieToken ?? null,
    close: async () => {
      clearInterval(timer);
      store.close();
    },
  };
}
