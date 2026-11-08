# Login form

People connect without handling tokens: their MCP client opens a browser, they log in with their Mealie account, and that's it.

::: warning Read this first
Users type their Mealie password on a page served by this MCP server, not by Mealie. The page says so clearly. Only enable this on a server your users trust, and only over HTTPS.
:::

Accounts that sign in to Mealie through SSO or OIDC can't use this form, since they have no Mealie password.

## Setup

Generate a key and keep it safe:

```bash
openssl rand -base64 48
```

Set these in `.env` next to `docker-compose.yml`:

```bash
MEALIE_URL=https://your-mealie.example.com
MEALIE_MCP_PASSWORD_LOGIN=true
MCP_TOKEN_KEY=the-generated-key
MCP_BASE_URL=https://mcp.example.com
# How many reverse proxies sit in front of this server:
MCP_TRUST_PROXY_HOPS=1
```

Put the server behind a TLS-terminating reverse proxy, then start it:

```bash
docker compose up -d
```

Connect a client to `https://mcp.example.com`. With Claude Code:

```bash
claude mcp add --transport http mealie https://mcp.example.com
```

In this mode the server doesn't accept Mealie API keys, and `MEALIE_API_TOKEN` must be unset.

## Staying logged in

`docker-compose.yml` keeps logins on the `mealie-mcp-data` named volume, so restarts and image updates don't log anyone out. A login stays valid as long as it's used at least once every 90 days.

- **Keep `MCP_TOKEN_KEY` the same.** With a different key the server refuses to start, rather than logging everyone out. To reset on purpose, delete `mealie-mcp.db*` from the volume.
- **Bind mounts** must be writable by uid 1000.
- **Run one replica.** Logins in progress and the SQLite database aren't shared between containers.

## Ending a login

Each login adds an entry named `mealie-mcp <date> <id>` under **API Tokens** in that user's Mealie profile. Deleting it ends the login: the current access token stops working in Mealie, and the next refresh asks the user to log in again.

## Other MCP clients

Loopback redirect URIs and Claude's hosted callbacks are allowed. Add others with `MCP_ALLOWED_REDIRECT_PREFIXES`.
