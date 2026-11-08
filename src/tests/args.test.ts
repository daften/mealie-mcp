import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';

afterEach(() => vi.unstubAllEnvs());

describe('parseArgs', () => {
  it('defaults to stdio on loopback', () => {
    expect(parseArgs([])).toMatchObject({ transport: 'stdio', host: '127.0.0.1', port: 3000, portWasExplicit: false });
  });
  it('accepts both flag forms', () => {
    expect(parseArgs(['--transport', 'http', '--port=4000'])).toMatchObject({
      transport: 'http',
      port: 4000,
      portWasExplicit: true,
    });
  });
  it('rejects unknown flags and suggests a fix', () => {
    expect(() => parseArgs(['--readonly'])).toThrow(/Did you mean --read-only/);
  });
  it('rejects invalid ports and transports', () => {
    expect(() => parseArgs(['--port', '0'])).toThrow(/between 1 and 65535/);
    expect(() => parseArgs(['--transport', 'sse'])).toThrow(/stdio/);
  });
  it('validates presets and groups, own keys only', () => {
    expect(parseArgs(['--preset', 'minimal']).filterOptions.preset).toBe('minimal');
    expect(() => parseArgs(['--preset', 'toString'])).toThrow(/Unknown preset/);
    expect(() => parseArgs(['--groups', 'recipes,nope'])).toThrow(/Unknown group/);
    expect(() => parseArgs(['--preset', 'minimal', '--groups', 'recipes'])).toThrow(/both/);
  });
  it('reads env fallbacks, strictly', () => {
    vi.stubEnv('MCP_READ_ONLY', 'true');
    expect(parseArgs([]).filterOptions.readOnly).toBe(true);
    vi.stubEnv('MCP_READ_ONLY', 'yes');
    expect(() => parseArgs([])).toThrow(/MCP_READ_ONLY/);
  });
});
