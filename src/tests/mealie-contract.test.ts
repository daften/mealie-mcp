// Contract test: every HTTP request any tool makes must be a route Mealie actually serves. Unit tests
// mock the client, so they can't notice a path that doesn't exist upstream.
//
// Refresh the snapshot with `node scripts/update-mealie-routes.mjs <mealie-url>`.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { MealieClient } from '../client.js';
import { registerAllTools } from '../tools/index.js';
import { createMockServer } from './_helpers.js';

const { routes } = JSON.parse(readFileSync(new URL('./fixtures/mealie-routes.json', import.meta.url), 'utf8')) as {
  routes: string[];
};
const table = routes.map((route) => {
  const [method, path] = route.split(' ');
  return { method, pattern: new RegExp(`^${path.replace(/\{\}/g, '[^/]+')}$`) };
});

/** A plausible value for any schema the tools use, filling optional fields too for maximum coverage. */
function sample(schema: z.ZodType): unknown {
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
      return sample(def.innerType as z.ZodType);
    case 'number':
      return 7;
    case 'boolean':
      return true;
    case 'enum':
      return Object.values(def.entries as Record<string, string>)[0];
    case 'array':
      return [sample(def.element as z.ZodType)];
    case 'object':
      return Object.fromEntries(
        Object.entries(def.shape as Record<string, z.ZodType>).map(([key, value]) => [key, sample(value)]),
      );
    default:
      return 'x7';
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('Mealie route contract', () => {
  const mock = createMockServer();
  registerAllTools(mock.server, new MealieClient('https://m.example', 't'));

  it.each([...mock.handlers.keys()])('%s only calls real routes', async (name) => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${new URL(url).pathname}`);
        const body = { id: 'x7', items: [], page: 1, per_page: 1, total: 0, total_pages: 0 };
        return new Response(JSON.stringify(init.method === 'POST' && url.endsWith('/api/recipes') ? 'x7' : body));
      }),
    );
    const shape = mock.toolConfigs.get(name)?.inputSchema ?? {};
    const args = Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, sample(schema)]));
    args.url &&= 'https://example.com/';
    if ('image_base64' in args) args.image_base64 = 'aGk=';
    if ('file_base64' in args) args.file_base64 = 'aGk=';

    const result = (await mock.handlers.get(name)?.(args)) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError, result.content[0].text).toBeFalsy();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const [method, path] = call.split(' ');
      expect(
        table.some((route) => route.method === method && route.pattern.test(path)),
        `${call} is not a Mealie route`,
      ).toBe(true);
    }
  });
});
