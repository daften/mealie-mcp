// Runs every tool group against a real Mealie, because request *bodies* are only verified here.
// Needs an admin token on a disposable instance: it creates a second household and user.
import { createHash, randomBytes } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLoginAuth, passwordLogin } from '../auth/index.js';
import { MealieClient } from '../client.js';
import { createHttpHandler, requestContext } from '../http.js';
import { registerAllTools } from '../tools/index.js';
import { createMockServer } from './_helpers.js';

const SKIP = !process.env.MEALIE_INTEGRATION;
const url = process.env.MEALIE_URL ?? '';
const adminToken = process.env.MEALIE_API_TOKEN ?? '';
const unique = () => `${Date.now()}${randomBytes(2).toString('hex')}`;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

type Result = { isError?: boolean; content: Array<{ text: string }> };

function toolsFor(token: string) {
  const mock = createMockServer();
  registerAllTools(mock.server, new MealieClient(url, token));
  return async <T = Record<string, any>>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = (await mock.handlers.get(name)?.(args)) as Result;
    if (result.isError) throw new Error(`${name}: ${result.content[0].text}`);
    return JSON.parse(result.content[0].text) as T;
  };
}

async function api<T = any>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${url}/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

describe.skipIf(SKIP)('Integration: live Mealie', () => {
  const admin = toolsFor(adminToken);
  const email = `other-${unique()}@example.com`;
  const password = randomBytes(18).toString('base64url');
  let other: ReturnType<typeof toolsFor>;
  let otherId: string;

  beforeAll(async () => {
    const households = await api('/admin/households?perPage=50', adminToken);
    const group = await api(`/admin/groups/${households.items[0].groupId}`, adminToken);
    const householdName = `Other ${unique()}`;
    await api('/admin/households', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: householdName, groupId: group.id }),
    });
    const user = await api('/admin/users', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        username: email,
        fullName: 'Other User',
        email,
        password,
        group: group.name,
        household: householdName,
        admin: false,
        canInvite: false,
        canManage: false,
        canOrganize: true,
        advanced: false,
      }),
    });
    otherId = user.id;
    const session = await fetch(`${url}/api/auth/token`, {
      method: 'POST',
      body: new URLSearchParams({ username: email, password }),
    });
    const { access_token: jwt } = (await session.json()) as { access_token: string };
    const { token } = await api('/users/api-tokens', jwt, { method: 'POST', body: JSON.stringify({ name: 'other' }) });
    other = toolsFor(token);
  });

  afterAll(async () => {
    if (otherId) await api(`/admin/users/${otherId}`, adminToken, { method: 'DELETE' });
  });

  it('runs the organizer, ingredient and recipe lifecycle', async () => {
    const id = unique();
    const category = await admin('create_category', { name: `Cat ${id}` });
    const tag = await admin('create_tag', { name: `Tag ${id}` });
    const tool = await admin('create_recipe_tool', { name: `Tool ${id}` });
    const food = await admin('create_food', { name: `Food ${id}`, plural_name: `Foods ${id}` });
    const unit = await admin('create_unit', { name: `Unit ${id}`, abbreviation: 'u' });

    await admin('rename_category', { id: category.id, name: `Cat2 ${id}` });
    await admin('rename_tag', { id: tag.id, name: `Tag2 ${id}` });
    await admin('rename_recipe_tool', { id: tool.id, name: `Tool2 ${id}` });
    await admin('update_food', { id: food.id, description: 'green' });
    await admin('update_unit', { id: unit.id, description: 'small' });
    for (const name of ['list_categories', 'list_tags', 'list_recipe_tools', 'list_foods', 'list_units']) {
      expect((await admin(name)).total).toBeGreaterThan(0);
    }
    for (const name of ['list_unused_categories', 'list_unused_tags', 'list_unused_recipe_tools']) {
      await admin(name);
    }
    expect(await admin<unknown[]>('parse_ingredients', { ingredients: ['2 cups flour'] })).toHaveLength(1);

    const recipe = await admin('create_recipe', {
      name: `Soup ${id}`,
      description: 'Warm',
      recipe_servings: 4,
      total_time: '30 minutes',
      ingredients: [
        { note: 'two leeks' },
        { quantity: 1, food: { id: food.id, name: food.name }, unit: { id: unit.id, name: unit.name } },
      ],
      instructions: [{ text: 'Chop' }, { title: 'Cook', text: 'Simmer' }],
      notes: [{ title: 'Tip', text: 'Salt' }],
      nutrition: { calories: '120' },
      categories: [{ id: category.id, name: category.name, slug: category.slug }],
      tags: [{ id: tag.id, name: tag.name, slug: tag.slug }],
      tools: [{ id: tool.id, name: tool.name, slug: tool.slug }],
      settings: { showNutrition: true },
    });
    const { slug } = recipe;
    expect(recipe.recipeIngredient).toHaveLength(2);
    expect(recipe.recipeInstructions).toHaveLength(2);

    await admin('update_recipe', { slug, description: 'Hotter' });
    const updated = await admin('get_recipe', { slug });
    expect(updated.description).toBe('Hotter');
    expect(updated.recipeIngredient).toHaveLength(2); // a partial update leaves other fields alone

    expect((await admin('search_recipes', { search: `Soup ${id}`, tags: [tag.id] })).total).toBe(1);
    await admin('rate_recipe', { slug, rating: 4 });
    await admin('mark_recipe_made', { slug });
    const copy = await admin('duplicate_recipe', { slug, name: `Copy ${id}` });

    await admin('upload_recipe_image', { slug, image_base64: PNG, extension: 'png' });
    await admin('upload_recipe_asset', { slug, name: 'card', extension: 'png', file_base64: PNG });
    await admin('delete_recipe_image', { slug });

    await admin('delete_recipe', { slug: copy.slug });
    await admin('delete_recipe', { slug });
    await admin('delete_food', { id: food.id });
    await admin('delete_unit', { id: unit.id });
    await admin('delete_category', { id: category.id });
    await admin('delete_tag', { id: tag.id });
    await admin('delete_recipe_tool', { id: tool.id });
  });

  it('runs the cookbook lifecycle', async () => {
    const id = unique();
    const tag = await admin('create_tag', { name: `Freezer ${id}` });
    const book = await admin('create_cookbook', { name: `Freezer menu ${id}`, tags: [tag.id] });
    expect(book.queryFilterString).toContain(tag.id);
    await admin('update_cookbook', { id: book.id, description: 'Meals for the freezer' });
    const fetched = await admin('get_cookbook', { id: book.id });
    expect(fetched.description).toBe('Meals for the freezer');
    expect(fetched.queryFilterString).toContain(tag.id); // a partial update keeps the filter
    expect((await admin('list_cookbooks')).total).toBeGreaterThan(0);
    await admin('delete_cookbook', { id: book.id });
    await admin('delete_tag', { id: tag.id });
  });

  it('runs shopping and meal plans, and keeps them per household', async () => {
    const id = unique();
    const recipe = await admin('create_recipe', { name: `Plan ${id}`, ingredients: [{ note: 'one leek' }] });
    const { id: recipeId } = await admin('get_recipe', { slug: recipe.slug });
    const list = await admin('create_shopping_list', { name: `List ${id}` });
    await admin('rename_shopping_list', { id: list.id, name: `Renamed ${id}` });
    const added = await admin('add_shopping_items', { list_id: list.id, items: [{ note: 'milk', quantity: 2 }] });
    const itemId = added.createdItems[0].id;
    await admin('update_shopping_item', { id: itemId, checked: true, note: 'oat milk' });
    await admin('add_recipe_to_shopping_list', { list_id: list.id, recipe_id: recipeId, scale: 2 });

    const full = await admin('get_shopping_list', { id: list.id });
    expect(full.listItems.find((i: { id: string }) => i.id === itemId)).toMatchObject({
      note: 'oat milk',
      checked: true,
    });
    await expect(other('get_shopping_list', { id: list.id })).rejects.toThrow(/not found/i);
    await admin('delete_shopping_item', { id: itemId });
    expect((await admin('list_shopping_lists')).total).toBeGreaterThan(0);

    const date = '2031-03-15';
    const entry = await admin('create_mealplan_entry', { date, recipe_id: recipeId });
    await admin('create_mealplan_entry', { date, title: 'Leftovers', text: 'fridge', entry_type: 'lunch' });
    await admin('create_random_mealplan_entry', { date, entry_type: 'side' });
    await admin('update_mealplan_entry', { id: entry.id, entry_type: 'lunch', text: 'moved' });
    const plans = await admin('get_mealplans', { start_date: date, end_date: date });
    expect(plans.total).toBeGreaterThanOrEqual(3);
    expect((await other('get_mealplans', { start_date: date, end_date: date })).total).toBe(0);
    await admin('get_todays_meals');
    for (const plan of plans.items) await admin('delete_mealplan_entry', { id: plan.id });

    await admin('delete_shopping_list', { id: list.id });
    await admin('delete_recipe', { slug: recipe.slug });
  });

  it('reports who the token belongs to', async () => {
    expect((await other('get_current_user')).email).toBe(email);
  });

  it('logs in through the form and acts as that user', async () => {
    const verifier = 'v'.repeat(64);
    const redirect = 'http://127.0.0.1:9999/callback';
    let handler: ReturnType<typeof createHttpHandler> = async () => {};
    const server = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = await createLoginAuth(
      { baseUrl: base, tokenKey: randomBytes(32).toString('hex'), dataDir: ':memory:', trustProxyHops: 0 },
      url,
      [passwordLogin()],
    );
    let resolved: string | undefined;
    handler = createHttpHandler({ kind: 'login', auth }, async (_req, res) => {
      resolved = requestContext.getStore()?.token;
      res.writeHead(200);
      res.end();
    });
    try {
      const registration = await fetch(`${base}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [redirect], token_endpoint_auth_method: 'none' }),
      });
      const { client_id: clientId } = (await registration.json()) as { client_id: string };
      const authorize = new URL(`${base}/authorize`);
      authorize.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirect,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();
      const html = await (await fetch(authorize)).text();
      const flow = /name="flow" value="([^"]+)"/.exec(html)?.[1] as string;
      const login = await fetch(`${base}/oauth/login`, {
        method: 'POST',
        redirect: 'manual',
        body: new URLSearchParams({ flow, username: email, password }),
      });
      expect(login.status).toBe(303);
      const code = new URL(login.headers.get('location') as string).searchParams.get('code') as string;
      const tokenResponse = await fetch(`${base}/token`, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          code_verifier: verifier,
        }),
      });
      const tokens = (await tokenResponse.json()) as { access_token: string };
      await fetch(base, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      expect(resolved).toBeDefined();
      expect((await toolsFor(resolved as string)('get_current_user')).email).toBe(email);
    } finally {
      await auth.close();
      server.close();
    }
  });
});
