import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSafeApiPath, formatError, MealieClient, MealieError } from '../client.js';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status = 200, body = '{}') {
  const fetchMock = vi.fn(async () => new Response(status === 204 ? null : body, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('assertSafeApiPath', () => {
  it.each(['/recipes/../users', '/recipes/%2e%2e/users', '/a?b=1', '/a#b', 'no-slash', '/a\\b', '/a\n'])(
    'refuses %j',
    (p) => {
      expect(() => assertSafeApiPath(p)).toThrow(/unsafe/);
    },
  );
  it('allows a normal path', () => {
    expect(() => assertSafeApiPath('/households/shopping/lists/abc')).not.toThrow();
  });
});

describe('MealieClient', () => {
  it('calls /api with the bearer from the resolver on each request', async () => {
    const fetchMock = stubFetch();
    let token = 'one';
    const client = new MealieClient('https://m.example/', () => token);
    await client.get('/recipes');
    token = 'two';
    await client.get('/recipes');
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][0]).toBe('https://m.example/api/recipes');
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer one');
    expect((calls[1][1].headers as Record<string, string>).Authorization).toBe('Bearer two');
  });

  it('repeats array params and skips undefined ones', async () => {
    const fetchMock = stubFetch();
    await new MealieClient('https://m.example', 't').get('/recipes', { tags: ['a', 'b'], search: undefined });
    expect((fetchMock.mock.calls as unknown as Array<[string]>)[0][0]).toBe(
      'https://m.example/api/recipes?tags=a&tags=b',
    );
  });

  it('does not follow redirects', async () => {
    const fetchMock = stubFetch();
    await new MealieClient('https://m.example', 't').get('/recipes');
    expect((fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0][1].redirect).toBe('manual');
  });

  it('throws MealieError on failure and returns undefined on 204', async () => {
    stubFetch(404, '{"detail":"nope"}');
    await expect(new MealieClient('https://m.example', 't').get('/x')).rejects.toBeInstanceOf(MealieError);
    stubFetch(204);
    await expect(new MealieClient('https://m.example', 't').delete('/x')).resolves.toBeUndefined();
  });

  it('lets FormData set the multipart content type', async () => {
    const fetchMock = stubFetch();
    await new MealieClient('https://m.example', 't').sendForm('PUT', '/x', new FormData());
    const init = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0][1];
    expect(init.headers).not.toHaveProperty('Content-Type');
  });
});

describe('formatError', () => {
  const err = (status: number, body = '') => new MealieError(status, 'https://m/api/x', body);
  it('renders FastAPI validation details without the body prefix', () => {
    const body = JSON.stringify({ detail: [{ loc: ['body', 'name'], msg: 'Field required' }] });
    expect(formatError(err(422, body))).toBe('Validation failed: name — Field required');
  });
  it('uses a string detail', () => {
    expect(formatError(err(400, '{"detail":"Bad thing"}'))).toBe('Bad request: Bad thing');
  });
  it('handles auth, missing, redirect and server errors', () => {
    expect(formatError(err(401))).toMatch(/Authentication failed/);
    expect(formatError(err(404))).toBe('Resource not found.');
    expect(formatError(err(302))).toMatch(/MEALIE_URL/);
    expect(formatError(err(503))).toMatch(/server error/);
  });
});
