import { describe, expect, it } from 'vitest';
import { ConfigError, parseFlag, resolveHttpMode, startupWarnings } from '../config.js';

const KEY = 'k'.repeat(32);
const login = { MEALIE_MCP_PASSWORD_LOGIN: 'true', MCP_TOKEN_KEY: KEY, MCP_BASE_URL: 'https://mcp.example.com' };

describe('parseFlag', () => {
  it('rejects anything unrecognized', () => {
    expect(parseFlag('X', '1')).toBe(true);
    expect(parseFlag('X', undefined)).toBe(false);
    expect(() => parseFlag('X', 'yes')).toThrow(ConfigError);
  });
});

describe('resolveHttpMode', () => {
  it('defaults to per-caller keys', () => {
    expect(resolveHttpMode({}, '127.0.0.1', 3000)).toEqual({ kind: 'per-caller' });
  });
  it('selects server-key mode from MEALIE_API_TOKEN', () => {
    expect(resolveHttpMode({ MEALIE_API_TOKEN: 'abc' }, '0.0.0.0', 3000)).toEqual({ kind: 'server-key', token: 'abc' });
  });
  it('selects login mode', () => {
    expect(resolveHttpMode(login, '0.0.0.0', 3000)).toMatchObject({
      kind: 'login',
      config: { baseUrl: 'https://mcp.example.com', dataDir: './data', trustProxyHops: 0 },
    });
  });
  it('makes login and a server key mutually exclusive', () => {
    expect(() => resolveHttpMode({ ...login, MEALIE_API_TOKEN: 'abc' }, '0.0.0.0', 3000)).toThrow(/exclusive/);
  });
  it('refuses a missing or short key', () => {
    expect(() => resolveHttpMode({ ...login, MCP_TOKEN_KEY: '' }, '0.0.0.0', 3000)).toThrow(/MCP_TOKEN_KEY/);
    expect(() => resolveHttpMode({ ...login, MCP_TOKEN_KEY: 'short' }, '0.0.0.0', 3000)).toThrow(/MCP_TOKEN_KEY/);
  });
  it('requires MCP_BASE_URL off loopback only', () => {
    const { MCP_BASE_URL: _unused, ...noBase } = login;
    expect(() => resolveHttpMode(noBase, '0.0.0.0', 3000)).toThrow(/MCP_BASE_URL/);
    expect(resolveHttpMode(noBase, '127.0.0.1', 4000)).toMatchObject({ config: { baseUrl: 'http://127.0.0.1:4000' } });
  });
  it('refuses plain http off loopback, and a base path', () => {
    expect(() => resolveHttpMode({ ...login, MCP_BASE_URL: 'http://mcp.example.com' }, '0.0.0.0', 3000)).toThrow(
      /https/,
    );
    expect(() => resolveHttpMode({ ...login, MCP_BASE_URL: 'https://x.example/mcp' }, '0.0.0.0', 3000)).toThrow(
      /no path/,
    );
    expect(resolveHttpMode({ ...login, MCP_BASE_URL: 'http://localhost:3000' }, '0.0.0.0', 3000)).toMatchObject({
      kind: 'login',
    });
  });
  it('rejects a bad flag value and bad proxy hops', () => {
    expect(() => resolveHttpMode({ MEALIE_MCP_PASSWORD_LOGIN: 'on' }, '127.0.0.1', 3000)).toThrow(/must be/);
    expect(() => resolveHttpMode({ ...login, MCP_TRUST_PROXY_HOPS: 'x' }, '0.0.0.0', 3000)).toThrow(/HOPS/);
  });
  it('reads the refresh check timeout in seconds, off by default', () => {
    const ms = (value?: string) => {
      const mode = resolveHttpMode({ ...login, MCP_REFRESH_CHECK_TIMEOUT_SECONDS: value }, '0.0.0.0', 3000);
      return mode.kind === 'login' ? mode.config.refreshCheckTimeoutMs : undefined;
    };
    expect(ms()).toBe(0);
    expect(ms('5')).toBe(5000);
    expect(() => ms('30')).toThrow(/below 30/);
    expect(() => ms('2.5')).toThrow(/MCP_REFRESH_CHECK_TIMEOUT_SECONDS/);
  });
});

describe('startupWarnings', () => {
  it('warns for a server key off loopback only', () => {
    const mode = { kind: 'server-key', token: 't' } as const;
    expect(startupWarnings(mode, '0.0.0.0')[0]).toMatch(/Anyone who can reach/);
    expect(startupWarnings(mode, '127.0.0.1')).toEqual([]);
  });
  it('always warns in login mode, and never for per-caller keys', () => {
    expect(startupWarnings(resolveHttpMode(login, '0.0.0.0', 3000), '0.0.0.0').join()).toMatch(/not by Mealie/);
    expect(startupWarnings({ kind: 'per-caller' }, '0.0.0.0')).toEqual([]);
  });
});
