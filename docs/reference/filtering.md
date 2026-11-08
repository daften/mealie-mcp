# Tool filtering

With 58 tools across 7 groups, loading everything consumes significant context window space. Three flags let you control exactly which tools are registered.

## --preset \<name\>

Load a named subset of tool groups:

| Preset | Groups included | Tools |
|--------|----------------|-------|
| `minimal` | recipes | 10 |
| `default` | recipes, shopping, mealplans | 25 |
| `full` | all 7 groups | 58 |

```bash
node dist/index.js --preset default
npx @daften/mealie-mcp --preset minimal
```

## --groups \<list\>

Comma-separated list of specific groups. Cannot combine with `--preset`.

Valid group names: `recipes`, `recipe-assets`, `ingredients`, `organizers`, `cookbooks`, `shopping`, `mealplans`

```bash
node dist/index.js --groups recipes,shopping
```

## --read-only

Filter any selection down to read-only tools: every tool annotated `readOnlyHint: true` (18 tools with no other filter). All create, update, delete and upload tools are excluded. Can combine with `--preset` or `--groups`.

Unrecognized flags are an error rather than being ignored, so a typo such as `--readonly` stops the server with a suggestion instead of starting it with write access. Value flags accept both `--flag value` and `--flag=value`.

```bash
node dist/index.js --preset default --read-only
```

Without any filter flags the server registers all 58 tools (equivalent to `--preset full`).

## Environment variable equivalents

Each flag has an environment variable fallback. The CLI flag always takes precedence.

| Variable | Equivalent flag | Example |
|----------|-----------------|---------|
| `MCP_PRESET` | `--preset <name>` | `MCP_PRESET=default` |
| `MCP_GROUPS` | `--groups <list>` | `MCP_GROUPS=recipes,shopping` |
| `MCP_READ_ONLY` | `--read-only` | `MCP_READ_ONLY=true` (also accepts `1`; `false`, `0` or empty mean off; any other value is an error) |

`MCP_PRESET` and `MCP_GROUPS` are mutually exclusive.
