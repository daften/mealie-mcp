#!/usr/bin/env node
// Snapshots Mealie's REST route table from a running instance, for the tool contract test
// (src/tests/mealie-contract.test.ts). Only HTTP methods and path templates are recorded.
//
// Usage: node scripts/update-mealie-routes.mjs http://localhost:9925
//    or: node scripts/update-mealie-routes.mjs ./openapi.json
// Writes: src/tests/fixtures/mealie-routes.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

async function load(source) {
  if (!/^https?:/.test(source)) return JSON.parse(readFileSync(source, 'utf8'));
  const response = await fetch(`${source.replace(/\/$/, '')}/openapi.json`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GET ${source}/openapi.json returned HTTP ${response.status}`);
  return response.json();
}

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/update-mealie-routes.mjs <mealie-url-or-openapi-file>');
  process.exit(1);
}
const spec = await load(source);
const routes = Object.entries(spec.paths)
  .flatMap(([path, operations]) =>
    METHODS.filter((m) => operations[m]).map((m) => `${m.toUpperCase()} ${path.replace(/\{[^}]+\}/g, '{}')}`),
  )
  .sort();
if (routes.length < 100) throw new Error(`Only ${routes.length} routes found; refusing to write.`);
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/tests/fixtures/mealie-routes.json');
writeFileSync(out, `${JSON.stringify({ version: spec.info.version, routes }, null, 2)}\n`);
console.log(`Wrote ${routes.length} routes for Mealie ${spec.info.version}`);
