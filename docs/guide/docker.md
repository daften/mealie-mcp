# Docker and API keys

```bash
MEALIE_URL=https://your-mealie.example.com docker compose up -d
```

## Each client sends its own key (default)

Leave `MEALIE_API_TOKEN` unset. Every request must carry a Mealie API token, and acts as that token's user:

```
Authorization: Bearer <mealie-api-token>
```

```bash
claude mcp add --transport http mealie http://localhost:3000 --header "Authorization: Bearer your-token"
```

## One server-wide key

Set `MEALIE_API_TOKEN` and every request acts as that one user, with no token needed from the client. Any `Authorization` header is ignored.

::: danger
There is no authentication in this mode. Anyone who can reach the port has that Mealie account's access, and the server prints a warning at startup when bound off loopback. Use it only on a trusted network or behind your own authenticating proxy.
:::

`MEALIE_API_TOKEN` can't be combined with the login form: the server refuses to start.
