import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import type { MealieClient } from '../client.js';
import { decodeBase64, mergePut, shapePage } from '../tools/_helpers.js';
import { buildQueryFilter } from '../tools/cookbooks.js';
import { PRESETS, registerAllTools, TOOL_GROUPS } from '../tools/index.js';
import { summarizeRecipe, toRecipePatch } from '../tools/recipes.js';
import { createMockServer } from './_helpers.js';

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn(async () => ({})),
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    patch: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
    sendForm: vi.fn(async () => ({})),
    ...overrides,
  } as unknown as MealieClient &
    Record<'get' | 'post' | 'put' | 'patch' | 'delete' | 'sendForm', ReturnType<typeof vi.fn>>;
}

function setup(client = mockClient(), options = {}) {
  const mock = createMockServer();
  registerAllTools(mock.server, client, options);
  return { ...mock, client };
}

const run = (m: ReturnType<typeof setup>, name: string, args: Record<string, unknown>) =>
  (
    m.handlers.get(name) as (
      a: Record<string, unknown>,
    ) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>
  )(args);

const LIST = '11111111-1111-4111-8111-111111111111';
const RECIPE = '22222222-2222-4222-8222-222222222222';

describe('registration', () => {
  it('annotates every tool and keeps names unique', () => {
    const { toolConfigs } = setup();
    expect(toolConfigs.size).toBeGreaterThan(40);
    for (const [name, config] of toolConfigs) {
      expect(config.description, name).toBeTruthy();
      expect(config.annotations, name).toBeDefined();
    }
  });
  it('honours presets and groups', () => {
    const minimal = setup(mockClient(), { preset: 'minimal' }).toolConfigs;
    expect(minimal.has('search_recipes')).toBe(true);
    expect(minimal.has('list_shopping_lists')).toBe(false);
    expect(setup(mockClient(), { groups: ['shopping'] }).toolConfigs.has('search_recipes')).toBe(false);
    expect(new Set(PRESETS.full)).toEqual(new Set(TOOL_GROUPS));
  });
  it('registers only read tools in read-only mode', () => {
    const { toolConfigs } = setup(mockClient(), { readOnly: true });
    expect(toolConfigs.has('search_recipes')).toBe(true);
    for (const [name, config] of toolConfigs) expect(config.annotations?.readOnlyHint, name).toBe(true);
  });
});

describe('strict inputs', () => {
  it('rejects an unknown parameter, naming it and listing the valid ones', () => {
    const { schemas } = setup();
    const result = schemas.get('search_recipes')?.safeParse({ query: 'soup' });
    expect(result?.success).toBe(false);
    const message = result?.error?.issues[0].message ?? '';
    expect(message).toContain('"query"');
    expect(message).toContain('search, categories, tags');
  });
  it('accepts every parameter a tool declares', () => {
    const { schemas } = setup();
    expect(schemas.get('search_recipes')?.safeParse({ search: 'soup', tags: ['a'], page: 1 }).success).toBe(true);
  });
  it('rejects unknown parameters on every tool, including ones that take none', () => {
    const { schemas } = setup();
    expect(schemas.size).toBeGreaterThan(50);
    for (const [name, schema] of schemas) {
      expect(schema.safeParse({ definitely_not_a_parameter: 1 }).success, name).toBe(false);
    }
  });
  it('reaches the client as a clear error over a real MCP connection', async () => {
    const server = new McpServer({ name: 'test', version: '0' });
    registerAllTools(server, mockClient());
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const outcome = await client
      .callTool({ name: 'search_recipes', arguments: { query: 'soup' } })
      .then((r) => JSON.stringify(r))
      .catch((e: Error) => e.message);
    expect(outcome).toContain('Unknown parameter');
    expect(outcome).toContain('query');
    await client.close();
  });
});

describe('recipes', () => {
  it('maps search args to Mealie params', async () => {
    const client = mockClient({
      get: vi.fn(async () => ({ page: 1, per_page: 50, total: 0, total_pages: 0, items: [] })),
    });
    await run(setup(client), 'search_recipes', { search: 'soup', tags: ['t'], require_all: true });
    expect(client.get).toHaveBeenCalledWith(
      '/recipes',
      expect.objectContaining({ search: 'soup', tags: ['t'], requireAllTags: true, page: 1, perPage: 50 }),
    );
  });
  it('creates then patches only when there are extra fields', async () => {
    const client = mockClient({ post: vi.fn(async () => 'soup') });
    const m = setup(client);
    expect(JSON.parse((await run(m, 'create_recipe', { name: 'Soup' })).content[0].text)).toEqual({ slug: 'soup' });
    expect(client.patch).not.toHaveBeenCalled();
    await run(m, 'create_recipe', { name: 'Soup', description: 'Hot' });
    expect(client.patch).toHaveBeenCalledWith('/recipes/soup', { description: 'Hot' });
  });
  it('maps field names and leaves unmentioned ones out', () => {
    expect(toRecipePatch({ recipe_servings: 4, org_url: 'https://x.example' })).toEqual({
      recipeServings: 4,
      orgURL: 'https://x.example',
    });
  });
  it('summarizes search results', () => {
    expect(
      summarizeRecipe({ id: '1', slug: 's', name: 'N', tags: [{ name: 'a' }], recipeCategory: null }),
    ).toMatchObject({ tags: ['a'], categories: [], tools: [] });
  });
  it('turns API failures into tool errors', async () => {
    const client = mockClient({
      get: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    expect(await run(setup(client), 'get_recipe', { slug: 'x' })).toMatchObject({
      isError: true,
      content: [{ text: 'boom' }],
    });
  });
  it('rejects a slug that would change the path', () => {
    const shape = setup().toolConfigs.get('get_recipe')?.inputSchema.slug;
    for (const bad of ['../users', 'a/b', '..', 'a?b', '%2e%2e'])
      expect(shape?.safeParse(bad).success, bad).toBe(false);
    expect(shape?.safeParse('tomato-soup').success).toBe(true);
  });
});

describe('cookbooks', () => {
  const TAG = '33333333-3333-4333-8333-333333333333';
  const COOKBOOK = '44444444-4444-4444-8444-444444444444';
  it('builds the filter from tag IDs when creating', async () => {
    const client = mockClient();
    await run(setup(client), 'create_cookbook', { name: 'Freezer menu', tags: [TAG] });
    expect(client.post).toHaveBeenCalledWith('/households/cookbooks', {
      name: 'Freezer menu',
      description: '',
      public: false,
      position: 1,
      queryFilterString: `tags.id IN ["${TAG}"]`,
    });
  });
  it('joins filters with AND and honours match=all', () => {
    expect(buildQueryFilter({ tags: [TAG], foods: [RECIPE], match: 'all' })).toBe(
      `tags.id CONTAINS ALL ["${TAG}"] AND recipe_ingredient.food.id CONTAINS ALL ["${RECIPE}"]`,
    );
  });
  it('refuses a raw filter combined with structured ones', async () => {
    const client = mockClient();
    const result = await run(setup(client), 'create_cookbook', {
      name: 'x',
      tags: [TAG],
      query_filter_string: 'tags.id IN []',
    });
    expect(result.isError).toBe(true);
    expect(client.post).not.toHaveBeenCalled();
  });
  it('keeps the existing filter when an update names no filter', async () => {
    const client = mockClient({
      get: vi.fn(async () => ({ id: COOKBOOK, name: 'Old', queryFilterString: 'a IN ["b"]' })),
    });
    await run(setup(client), 'update_cookbook', { id: COOKBOOK, name: 'New' });
    expect(client.put).toHaveBeenCalledWith(`/households/cookbooks/${COOKBOOK}`, {
      id: COOKBOOK,
      name: 'New',
      queryFilterString: 'a IN ["b"]',
    });
  });
  it('replaces the filter when asked, and an empty string clears it', async () => {
    const client = mockClient({ get: vi.fn(async () => ({ id: COOKBOOK, queryFilterString: 'a IN ["b"]' })) });
    await run(setup(client), 'update_cookbook', { id: COOKBOOK, query_filter_string: '' });
    expect(client.put).toHaveBeenCalledWith(`/households/cookbooks/${COOKBOOK}`, {
      id: COOKBOOK,
      queryFilterString: '',
    });
  });
});

describe('shopping', () => {
  it('adds items in bulk against the list', async () => {
    const client = mockClient();
    await run(setup(client), 'add_shopping_items', { list_id: LIST, items: [{ note: 'milk', quantity: 2 }] });
    expect(client.post).toHaveBeenCalledWith('/households/shopping/items/create-bulk', [
      { shoppingListId: LIST, note: 'milk', quantity: 2 },
    ]);
  });
  it('merges item updates over the current record', async () => {
    const client = mockClient({
      get: vi.fn(async () => ({ id: LIST, shoppingListId: 'l', note: 'old', checked: false })),
    });
    await run(setup(client), 'update_shopping_item', { id: LIST, checked: true });
    expect(client.put).toHaveBeenCalledWith(`/households/shopping/items/${LIST}`, {
      id: LIST,
      shoppingListId: 'l',
      note: 'old',
      checked: true,
    });
  });
  it('adds a recipe with a scale', async () => {
    const client = mockClient();
    await run(setup(client), 'add_recipe_to_shopping_list', { list_id: LIST, recipe_id: RECIPE, scale: 2 });
    expect(client.post).toHaveBeenCalledWith(`/households/shopping/lists/${LIST}/recipe`, [
      { recipeId: RECIPE, recipeIncrementQuantity: 2 },
    ]);
  });
});

describe('meal plans', () => {
  it('defaults the entry type', async () => {
    const client = mockClient();
    await run(setup(client), 'create_mealplan_entry', { date: '2026-11-08', recipe_id: RECIPE });
    expect(client.post).toHaveBeenCalledWith('/households/mealplans', {
      date: '2026-11-08',
      entryType: 'dinner',
      recipeId: RECIPE,
    });
  });
});

describe('assets', () => {
  it('uploads multipart with the decoded file', async () => {
    const client = mockClient();
    await run(setup(client), 'upload_recipe_image', { slug: 's', image_base64: 'aGk=', extension: 'jpg' });
    const [method, path, form] = client.sendForm.mock.calls[0] as [string, string, FormData];
    expect([method, path, form.get('extension')]).toEqual(['PUT', '/recipes/s/image', 'jpg']);
    expect(await (form.get('image') as Blob).text()).toBe('hi');
  });
});

describe('helpers', () => {
  it('mergePut ignores undefined changes', async () => {
    const client = mockClient({ get: vi.fn(async () => ({ a: 1, b: 2 })) });
    await mergePut(client, '/x', { a: undefined, b: 3 });
    expect(client.put).toHaveBeenCalledWith('/x', { a: 1, b: 3 });
  });
  it('shapePage drops navigation links', () => {
    const page = { page: 1, per_page: 2, total: 3, total_pages: 2, items: [{}], next: '/x', previous: null };
    expect(shapePage(page)).toEqual({ page: 1, per_page: 2, total: 3, total_pages: 2, items: [{}] });
  });
  it('decodeBase64 rejects invalid input', () => {
    expect(() => decodeBase64('not base64!', 'f')).toThrow(/f is not valid/);
    expect(Buffer.from(decodeBase64('aGk=', 'f')).toString()).toBe('hi');
  });
});
