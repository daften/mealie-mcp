#!/usr/bin/env node
// Snapshots one Mealie release's REST route table, for the tool contract test
// (src/tests/mealie-contract.test.ts). Only HTTP methods and path templates are recorded.
//
// Usage: node scripts/update-mealie-routes.mjs <url-or-file>   e.g. http://localhost:9925
// Writes:  src/tests/fixtures/mealie-routes-<version>.json
//
// Mealie generates its OpenAPI document at runtime and recent releases don't keep a copy in the
// repository, so unlike a source-file parser this needs that release running (or a saved copy).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export function parseRoutes(spec) {
  const routes = new Set();
  for (const [path, operations] of Object.entries(spec.paths ?? {})) {
    if (!path.startsWith('/api/')) continue;
    for (const method of METHODS) {
      // Name every path parameter `{}`: only the shape matters for matching.
      if (operations[method]) routes.add(`${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, '{}')}`);
    }
  }
  return [...routes].sort();
}

// The version comes from the server's OpenAPI document and is spliced into the output file name, so
// it is matched in full: a trailing '/../' would otherwise write outside the fixtures directory.
export function fixtureTag(version) {
  if (typeof version !== 'string' || !/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Unrecognized Mealie version: ${version}`);
  }
  return version.startsWith('v') ? version : `v${version}`;
}

async function load(source) {
  if (!/^https?:/.test(source)) return JSON.parse(readFileSync(source, 'utf8'));
  const url = `${source.replace(/\/$/, '')}/openapi.json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error('Usage: node scripts/update-mealie-routes.mjs <mealie-url-or-openapi-file>');
    process.exit(1);
  }
  const spec = await load(source);
  const tag = fixtureTag(spec.info?.version);
  const routes = parseRoutes(spec);
  if (routes.length < 100) throw new Error(`Only ${routes.length} routes found in ${source}; refusing to write.`);
  const out = resolve(dirname(fileURLToPath(import.meta.url)), `../src/tests/fixtures/mealie-routes-${tag}.json`);
  writeFileSync(out, `${JSON.stringify({ tag, routes }, null, 2)}\n`);
  console.log(`Wrote ${routes.length} routes to ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
