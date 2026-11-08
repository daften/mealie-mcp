# Mealie MCP server

An MCP server for [Mealie](https://mealie.io). TypeScript, ESM, strict. Runs over stdio or streamable HTTP, and one HTTP server can serve many users who each act as themselves.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Biome, both typechecks, all tests. Run before every commit |
| `npm run build` | Compile to `dist/` |
| `npm run dev -- --transport http` | Run from source with `.env` |
| `npm run docs:dev` | Docs site |
| `node scripts/update-mealie-routes.mjs <url>` | Refresh the route snapshot used by the contract test |

## Layout

```
src/index.ts      entry: transport switch, startup
src/args.ts       CLI flags and tool-filter env vars
src/config.ts     chooses the HTTP auth mode, startup refusals and warnings
src/http.ts       health, bearer resolution, stateless MCP handler
src/client.ts     MealieClient and formatError
src/tools/        one file per tool group
src/auth/         login mode only; loaded dynamically, so other modes never touch SQLite or Express
```

## Auth modes

Exactly one HTTP mode is active, chosen once at startup in `resolveHttpMode`. All of them end with a Mealie token in `requestContext`, so tools never know how the user logged in.

| Mode | Enabled by | Caller sends |
|---|---|---|
| Per-caller key (default) | nothing | their own Mealie API token |
| Server key | `MEALIE_API_TOKEN` | nothing; any bearer is ignored |
| Login form | `MEALIE_MCP_PASSWORD_LOGIN` | `mcp_at_…` from the OAuth flow |

Login mode never forwards a Mealie key. Mealie has no OAuth server, so this server is the authorization server (the SDK's `mcpAuthRouter` plus `MealieOAuthProvider`). Mealie tokens are encrypted with `MCP_TOKEN_KEY` in SQLite; bearer tokens are stored only as SHA-256 hashes.

### Adding OIDC

Implement `LoginMethod` (`src/auth/login-method.ts`). Redirect to the identity provider from `begin`, register the callback in `register`, exchange the code at `POST /api/auth/oauth/native/token`, and pass the returned session JWT to `context.completeLogin`. Enable it from `resolveHttpMode` and `index.ts`.

## Conventions

- Every tool goes through `defineTool` with an annotation from `_annotations.ts`. Read-only filtering relies on those annotations.
- Tool arguments that end up in a URL need a validating schema (`slugSchema`, `idSchema`). `assertSafeApiPath` is the backstop.
- Tool inputs are `snake_case` and map to Mealie's `camelCase` in the handler.
- Mealie PUT routes usually want the whole object: use `mergePut` for partial updates.
- Unknown flags and env values are errors, never silently ignored.
- Never log request bodies on auth routes. Never write to stdout in stdio mode.
- New schema changes are appended to `MIGRATIONS` in `src/auth/store.ts`; existing entries never change.

## Commits and branches

Conventional Commits. `develop` integrates and `main` stays releasable. Add user-facing changes to `## [Unreleased]` in `CHANGELOG.md`.
