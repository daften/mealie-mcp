# Environment variables

| Variable | Applies to | Description |
|---|---|---|
| `MEALIE_URL` | all | Required. Base URL of your Mealie instance |
| `MEALIE_API_TOKEN` | stdio, HTTP | Required for stdio. Over HTTP, selects server-key mode. Can't be combined with login |
| `MEALIE_MCP_PASSWORD_LOGIN` | HTTP | `true` or `1` enables the login form and turns off API keys |
| `MCP_TOKEN_KEY` | login | Required, 32+ characters. Encrypts stored tokens and must stay the same |
| `MCP_BASE_URL` | login | Public origin, with no path. Required off loopback, and must be `https://` there |
| `MCP_DATA_DIR` | login | Where the database lives. `/data` in the Docker image, otherwise `./data` |
| `MCP_TRUST_PROXY_HOPS` | login | Number of reverse proxies in front, so rate limits see client IPs. Default `0` |
| `MCP_ALLOWED_REDIRECT_PREFIXES` | login | Extra allowed OAuth redirect URI prefixes, comma-separated |
| `MCP_PRESET` | all | `minimal`, `default` or `full`. Fallback for `--preset` |
| `MCP_GROUPS` | all | Comma-separated tool groups. Fallback for `--groups` |
| `MCP_READ_ONLY` | all | `true` or `1` registers only read tools. Fallback for `--read-only` |

CLI flags: `--transport stdio|http`, `--host`, `--port`, `--preset`, `--groups`, `--read-only`.
