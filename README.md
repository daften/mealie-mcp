# Mealie MCP server

Connects AI assistants to [Mealie](https://mealie.io) through the [Model Context Protocol](https://modelcontextprotocol.io): search and write recipes, manage shopping lists, and plan meals.

One Docker container can serve a whole household or team, with each person acting as their own Mealie user.

## Quick start: stdio

Create an API token in Mealie under **Profile → API Tokens**, then add this to your MCP client:

```json
{
  "mcpServers": {
    "mealie": {
      "command": "npx",
      "args": ["-y", "@daften/mealie-mcp"],
      "env": {
        "MEALIE_URL": "https://your-mealie.example.com",
        "MEALIE_API_TOKEN": "your-token"
      }
    }
  }
}
```

## Quick start: Docker

```bash
MEALIE_URL=https://your-mealie.example.com docker compose up -d
```

Each client then sends its own Mealie API token as a Bearer token:

```bash
claude mcp add --transport http mealie http://localhost:3000 --header "Authorization: Bearer your-token"
```

## Auth modes

Pick one. Over HTTP, the modes are exclusive.

| Mode | Set | Who it's for |
|---|---|---|
| Your own API key per client | nothing (default) | Several users, no extra setup |
| One server-wide API key | `MEALIE_API_TOKEN` | One person on a trusted network. Anyone who can reach the port acts as that user |
| Login form | `MEALIE_MCP_PASSWORD_LOGIN=true` | Several users who'd rather log in than copy tokens. They type their Mealie password on a page served by this server |

See the [login form guide](docs/guide/login-form.md) before enabling it.

## Tools

53 tools in six groups: `recipes`, `recipe-assets`, `ingredients`, `organizers`, `shopping`, `mealplans`. Limit them with `--preset minimal|default|full`, `--groups recipes,shopping` or `--read-only`. The [tool reference](docs/reference/tools.md) lists them all.

## Documentation

- [stdio](docs/guide/stdio.md)
- [Docker and API keys](docs/guide/docker.md)
- [Login form](docs/guide/login-form.md)
- [Environment variables](docs/reference/env-vars.md)

Tested against Mealie v3.30.0. Requires Node.js 22.13 or newer.

## License

MIT
