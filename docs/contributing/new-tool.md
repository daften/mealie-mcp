# Adding a new tool

## Overview

Each tool lives in a file under `src/tools/`. Each file exports a `registerXxxTools(server, client)` function that calls `defineTool()` for each tool it owns. `defineTool` (in `src/tools/_helpers.ts`) is a thin wrapper over `server.registerTool()` that adds the `try/catch` and JSON serialization every tool needs, so handlers just return a plain value.

## Step 1: Check Mealie's API

Before implementing, verify field names, required/optional status, and response shapes against the OpenAPI document of a running instance:

```bash
docker compose -f docker-compose.ci.yml up -d
curl -s http://localhost:9925/openapi.json | python3 -m json.tool | grep -A 40 '"YourSchema"'
```

## Step 2: Write a failing test

In `src/tests/tools.test.ts`, assert the request the tool sends:

```typescript
it('gets one thing', async () => {
  const client = mockClient();
  await run(setup(client), 'get_my_thing', { id: LIST });
  expect(client.get).toHaveBeenCalledWith(`/my-things/${LIST}`);
});
```

Run it to confirm it fails: `npm test -- src/tests/tools.test.ts`

## Step 3: Register the tool

In the `registerXxxTools(server, client)` function, call `defineTool`:

```typescript
defineTool(
  server,
  'get_my_thing',
  {
    title: 'Get my thing',
    description: 'Gets one thing by ID.',
    inputSchema: { id: idSchema },
    annotations: READ_ANNOTATIONS,
  },
  ({ id }) => client.get(`/my-things/${id}`), // args are typed from inputSchema
);
```

Annotation constants live in `src/tools/_annotations.ts`: `READ_ANNOTATIONS`, `WRITE_ANNOTATIONS` (create), `UPDATE_ANNOTATIONS` (update) and `DELETE_ANNOTATIONS` (delete). Read-only filtering relies on them.

Any argument that becomes part of a URL path needs a validating schema (`slugSchema`, `idSchema`). Tool inputs are `snake_case` and map to Mealie's `camelCase` in the handler. Mealie PUT routes usually want the whole object, so use `mergePut` for partial updates.

## Step 4: Wire a new group (if creating a new tool file)

1. Add the group name to `TOOL_GROUPS` in `src/tools/index.ts`
2. Add its register function to `REGISTRARS` in the same file
3. Consider which presets it belongs in (`PRESETS`)

## Step 5: Update docs

1. Add the tool to the table in `docs/reference/tools.md`.
2. If the total or a preset's count changed, update the numbers in `README.md`, `docs/index.md`, `docs/guide/index.md`, `docs/reference/filtering.md` and `AGENTS.md`. `AGENTS.md`'s File Structure section lists every tool per file.
3. `npm run check` catches anything you miss: `src/tests/docs-consistency.test.ts` compares these lists and counts with the registered tools, and `src/tests/mealie-contract.test.ts` checks that every request your tool makes is a route Mealie serves on the oldest supported and newest tested releases.

## Step 6: Build and commit

```bash
npm run build
npm test
git add src/tools/my-category.ts src/tests/tools.test.ts docs/reference/tools.md AGENTS.md
git commit -m "feat: add get_my_thing tool"
```
