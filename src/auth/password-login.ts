import express, { type Response } from 'express';
import type { LoginContext, LoginMethod, PendingFlow } from './login-method.js';
import { MealieSessionApi, MealieUnavailableError } from './mealie-session.js';

export const LOGIN_PATH = '/oauth/login';
const WINDOW_MS = 15 * 60 * 1000;
// Below Mealie's default of 5 failed attempts, so this form can't be used to lock an account out.
export const MAX_FAILURES_PER_USERNAME = 4;
export const MAX_FAILURES_PER_IP = 20;
const MAX_TRACKED_KEYS = 10_000;

/** Counts failed attempts per key in a sliding-from-first-failure window. Bounded, because the keys are attacker-chosen. */
export class FailureLimiter {
  private readonly failures = new Map<string, { count: number; startedAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number = WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  private live(key: string): { count: number; startedAt: number } | undefined {
    const entry = this.failures.get(key);
    if (entry && this.now() - entry.startedAt > this.windowMs) {
      this.failures.delete(key);
      return undefined;
    }
    return entry;
  }

  isBlocked(key: string): boolean {
    return (this.live(key)?.count ?? 0) >= this.max;
  }

  recordFailure(key: string): void {
    const entry = this.live(key);
    if (entry) {
      entry.count++;
      return;
    }
    if (this.failures.size >= MAX_TRACKED_KEYS) {
      const oldest = this.failures.keys().next().value;
      if (oldest !== undefined) this.failures.delete(oldest);
    }
    this.failures.set(key, { count: 1, startedAt: this.now() });
  }

  clear(key: string): void {
    this.failures.delete(key);
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Chrome applies form-action to the redirect after submit, so the client's callback origin must be listed. */
export function formActionSource(redirectUri: string): string {
  const parsed = new URL(redirectUri);
  return parsed.origin === 'null' ? parsed.protocol : parsed.origin;
}

function renderPage(flow: PendingFlow, baseUrl: string, message?: string): string {
  const serverHost = new URL(baseUrl).host;
  const redirect = new URL(flow.params.redirectUri);
  const clientHost = redirect.host || redirect.protocol;
  const clientName = flow.client.client_name ?? 'An MCP client';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log in to Mealie MCP</title>
<style>
:root { color-scheme: light dark; }
body { font: 16px/1.5 system-ui, sans-serif; max-width: 26rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.4rem; margin-bottom: .25rem; }
.warning { border-left: 4px solid #d97706; padding: .5rem .75rem; margin: 1rem 0; background: rgba(217,119,6,.12); }
.error { border-left: 4px solid #dc2626; padding: .5rem .75rem; margin: 1rem 0; background: rgba(220,38,38,.12); }
label { display: block; margin-top: .75rem; font-weight: 600; }
input { box-sizing: border-box; width: 100%; padding: .5rem; font: inherit; margin-top: .25rem; }
button { margin-top: 1rem; padding: .6rem 1rem; font: inherit; width: 100%; cursor: pointer; }
.detail { font-size: .9rem; opacity: .85; }
</style>
</head>
<body>
<h1>Log in with your Mealie account</h1>
<p class="detail"><strong>${escapeHtml(clientName)}</strong> at <code>${escapeHtml(clientHost)}</code> is asking to use Mealie as you.</p>
<div class="warning"><strong>This page is not Mealie.</strong> Your password goes to the MCP server at <code>${escapeHtml(serverHost)}</code>, which passes it on to Mealie once and does not store it. Only continue if you trust this server. If you aren't sure, stop and ask whoever runs it.</div>
${message ? `<div class="error" role="alert">${escapeHtml(message)}</div>` : ''}
<form method="post" action="${LOGIN_PATH}" autocomplete="on">
<input type="hidden" name="flow" value="${escapeHtml(flow.id)}">
<label for="username">Email or username</label>
<input id="username" name="username" autocomplete="username" required autofocus>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Log in</button>
</form>
</body>
</html>`;
}

function sendPage(res: Response, status: number, flow: PendingFlow, baseUrl: string, message?: string): void {
  res
    .status(status)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self' ${formActionSource(flow.params.redirectUri)}; frame-ancestors 'none'`,
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    })
    .send(renderPage(flow, baseUrl, message));
}

const MESSAGES = {
  invalid:
    "Mealie didn't accept that email and password. Accounts that sign in through SSO or an external provider can't use this form.",
  locked: 'Mealie has locked this account after too many failed attempts. An administrator can unlock it.',
  throttled: 'Too many failed attempts. Wait 15 minutes and try again.',
  unavailable: "The server couldn't reach Mealie. Try again in a moment.",
};

export function passwordLogin(): LoginMethod {
  let baseUrl = '';

  return {
    id: 'password',
    paths: [LOGIN_PATH],
    begin(flow, res) {
      sendPage(res, 200, flow, baseUrl);
    },
    register(app, context: LoginContext) {
      baseUrl = context.baseUrl;
      const api = new MealieSessionApi(context.mealieUrl);
      const byUsername = new FailureLimiter(MAX_FAILURES_PER_USERNAME);
      const byIp = new FailureLimiter(MAX_FAILURES_PER_IP);

      app.post(LOGIN_PATH, express.urlencoded({ extended: false, limit: '64kb' }), async (req, res) => {
        const { flow: flowId, username, password } = (req.body ?? {}) as Record<string, unknown>;
        const taken = typeof flowId === 'string' ? context.takeFlow(flowId) : undefined;
        if (!taken) {
          res
            .status(400)
            .set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
            .send('This login page has expired. Start again from your MCP client.');
          return;
        }
        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
          sendPage(res, 400, context.renewFlow(taken), baseUrl, MESSAGES.invalid);
          return;
        }

        const ip = context.clientIp(req);
        const userKey = username.trim().toLowerCase();
        if (byUsername.isBlocked(userKey) || byIp.isBlocked(ip)) {
          sendPage(res, 429, context.renewFlow(taken), baseUrl, MESSAGES.throttled);
          return;
        }

        try {
          const result = await api.login(username.trim(), password);
          if (result.status === 'ok') {
            byUsername.clear(userKey);
            await context.completeLogin(taken, result.sessionJwt, res);
            return;
          }
          byUsername.recordFailure(userKey);
          byIp.recordFailure(ip);
          sendPage(res, 401, context.renewFlow(taken), baseUrl, MESSAGES[result.status]);
        } catch (err) {
          if (!(err instanceof MealieUnavailableError)) throw err;
          process.stderr.write(`Login failed: ${err.message}\n`);
          sendPage(res, 502, context.renewFlow(taken), baseUrl, MESSAGES.unavailable);
        }
      });
    },
  };
}
