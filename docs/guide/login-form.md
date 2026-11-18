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
- **Each refresh is logged** to the container output (`docker logs`), with how long the check against Mealie took and why a login ended. Tokens themselves are never logged.

### When a refresh response gets lost

Each refresh replaces the refresh token. If the client never receives the response (a dropped connection, a laptop that slept mid-request, a slow host), it retries with the old one. That works for one more minute. After that, the server can't tell the client apart from someone holding a copy of the old token, so presenting it ends the login and the user logs in again. The server log shows this as `reused … after rotation; ending the login`.

Late retries mostly happen when the token exchange itself is slow. Before answering, each refresh asks Mealie whether the login's API token still works, and on an overloaded host that can take up to 30 seconds. The server log shows how long it took (`Mealie check …s`). If that number is often high, set `MCP_REFRESH_CHECK_TIMEOUT_SECONDS`, for example to `5`. The refresh then answers after that many seconds without waiting for Mealie. If Mealie's answer arrives later and says the API token was deleted, the login still ends. The only cost is that a deleted API token can keep working for those few seconds, plus however long Mealie takes to answer. Off by default.

## Ending a login

Each login adds an entry named `mealie-mcp <date> <id>` under **API Tokens** in that user's Mealie profile. Deleting it ends the login: the current access token stops working in Mealie, and the next refresh asks the user to log in again.

## Other MCP clients

Loopback redirect URIs and Claude's hosted callbacks are allowed. Add others with `MCP_ALLOWED_REDIRECT_PREFIXES`.
