import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureTag, parseRoutes } from '../../scripts/update-mealie-routes.mjs';

test('records each method and normalizes path parameters', () => {
  const spec = { paths: { '/api/recipes/{slug}': { get: {}, patch: {} }, '/api/foods': { post: {} } } };
  assert.deepEqual(parseRoutes(spec), ['GET /api/recipes/{}', 'PATCH /api/recipes/{}', 'POST /api/foods'].sort());
});

test('ignores routes outside the API and keys that are not HTTP methods', () => {
  const spec = { paths: { '/': { get: {} }, '/api/x': { parameters: [], get: {} } } };
  assert.deepEqual(parseRoutes(spec), ['GET /api/x']);
});

test('deduplicates and sorts', () => {
  const spec = { paths: { '/api/b/{id}': { get: {} }, '/api/b/{other}': { get: {} }, '/api/a': { get: {} } } };
  assert.deepEqual(parseRoutes(spec), ['GET /api/a', 'GET /api/b/{}']);
});

test('tolerates a document with no paths', () => {
  assert.deepEqual(parseRoutes({}), []);
});

test('fixtureTag prefixes a bare version with v', () => {
  assert.equal(fixtureTag('3.29.0'), 'v3.29.0');
  assert.equal(fixtureTag('v3.29.0'), 'v3.29.0');
  assert.equal(fixtureTag('v3.30.0-beta.1'), 'v3.30.0-beta.1');
});

// The version comes from the server's OpenAPI document and becomes part of the output path.
test('fixtureTag rejects versions that could leave the fixtures directory', () => {
  for (const version of ['3.29.0/../../../../etc/x', '3.29.0/x', 'v3.29.0\\x', '3.29', undefined, 42]) {
    assert.throws(() => fixtureTag(version), /Unrecognized Mealie version/);
  }
});
