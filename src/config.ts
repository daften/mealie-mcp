import type { LoginConfig } from './auth/index.js';
import { classifyHost, type HttpAuth } from './http.js';

export class ConfigError extends Error {}

const MIN_TOKEN_KEY_LENGTH = 32;

/** Unrecognized values are an error, not "off": a typo must not quietly change what the server exposes. */
export function parseFlag(name: string, raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase() ?? '';
  if (value === 'true' || value === '1') return true;
  if (value === '' || value === 'false' || value === '0') return false;
  throw new ConfigError(`${name} must be "true", "1", "false" or "0", got "${raw}"`);
}

export type ResolvedMode = Exclude<HttpAuth, { kind: 'login' }> | { kind: 'login'; config: LoginConfig };

/** Chooses the single HTTP auth mode for this process. Everything here is decided once, at startup. */
export function resolveHttpMode(env: NodeJS.ProcessEnv, host: string, port: number): ResolvedMode {
  const serverKey = env.MEALIE_API_TOKEN?.trim();
  const passwordLogin = parseFlag('MEALIE_MCP_PASSWORD_LOGIN', env.MEALIE_MCP_PASSWORD_LOGIN);

  if (!passwordLogin) {
    return serverKey ? { kind: 'server-key', token: serverKey } : { kind: 'per-caller' };
  }

  if (serverKey) {
    throw new ConfigError(
      'MEALIE_API_TOKEN and MEALIE_MCP_PASSWORD_LOGIN cannot be used together: the auth modes are exclusive. Unset one of them.',
    );
  }

  const tokenKey = env.MCP_TOKEN_KEY?.trim() ?? '';
  if (tokenKey.length < MIN_TOKEN_KEY_LENGTH) {
    throw new ConfigError(
      `MCP_TOKEN_KEY must be set to at least ${MIN_TOKEN_KEY_LENGTH} characters when login is enabled. Generate one with: openssl rand -base64 48`,
    );
  }

  const trustProxyRaw = env.MCP_TRUST_PROXY_HOPS?.trim() || '0';
  if (!/^\d+$/.test(trustProxyRaw)) {
    throw new ConfigError(`MCP_TRUST_PROXY_HOPS must be a whole number, got "${env.MCP_TRUST_PROXY_HOPS}"`);
  }

  return {
    kind: 'login',
    config: {
      baseUrl: resolveBaseUrl(env.MCP_BASE_URL, host, port),
      tokenKey,
      dataDir: env.MCP_DATA_DIR?.trim() || './data',
      trustProxyHops: Number(trustProxyRaw),
    },
  };
}

function resolveBaseUrl(raw: string | undefined, host: string, port: number): string {
  const configured = raw?.trim().replace(/\/+$/, '');
  if (!configured) {
    if (classifyHost(host) === 'non-loopback') {
      throw new ConfigError(
        `MCP_BASE_URL must be set when login is enabled on a non-loopback interface (--host ${host}), e.g. MCP_BASE_URL=https://mcp.example.com`,
      );
    }
    return `http://${host === '::1' ? '[::1]' : host}:${port}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new ConfigError(`MCP_BASE_URL is not a valid URL: "${raw}"`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    // OAuth discovery and the SDK's auth router live at the origin root.
    throw new ConfigError('MCP_BASE_URL must be an origin with no path when login is enabled.');
  }
  // new URL() keeps the brackets on IPv6 hostnames.
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopback) {
    throw new ConfigError(
      'MCP_BASE_URL must use https:// when login is enabled: passwords would otherwise travel in clear text.',
    );
  }
  return parsed.origin;
}

export function startupWarnings(mode: ResolvedMode, host: string): string[] {
  if (mode.kind === 'server-key' && classifyHost(host) === 'non-loopback') {
    return [
      `WARNING: MEALIE_API_TOKEN is set and this server is bound to ${host}. Anyone who can reach this port acts as that Mealie user, with no authentication. Keep it on a trusted network.`,
    ];
  }
  if (mode.kind === 'login') {
    return [
      'WARNING: MEALIE_MCP_PASSWORD_LOGIN is enabled. Users type their Mealie password on a page served by this MCP server, not by Mealie.',
      'WARNING: Only enable this on a server your users trust, over HTTPS. Keep MCP_TOKEN_KEY stable and the data directory on a persistent volume.',
    ];
  }
  return [];
}
