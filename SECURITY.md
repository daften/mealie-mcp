# Security

Please report vulnerabilities privately through GitHub's security advisories on this repository, not in a public issue.

## What each mode trusts

| Mode | Who can act as whom |
|---|---|
| stdio | The local process acts as the owner of `MEALIE_API_TOKEN` |
| HTTP, per-caller key | Each caller needs their own valid Mealie API token |
| HTTP, server key | **Anyone who can reach the port acts as the owner of `MEALIE_API_TOKEN`.** There is no authentication. Keep it on a trusted network |
| HTTP, login form | Each user logs in. Their password passes through this server once |

## Login form

Users type their Mealie password on a page served by this server. The password is sent to Mealie once, and is never stored or logged. The server then creates a long-lived Mealie API token in that user's name.

- Mealie tokens are encrypted at rest with `MCP_TOKEN_KEY` (AES-256-GCM). Anyone holding both the database and the key can use those tokens, so store them separately where you can.
- Bearer tokens are stored only as SHA-256 hashes.
- Off loopback, the server refuses to start unless `MCP_BASE_URL` uses HTTPS.
- To revoke one login, delete its `mealie-mcp …` entry under API Tokens in the Mealie profile. Access ends immediately, because Mealie rejects the token, and the next refresh asks the user to log in again.
- Reusing a rotated refresh token more than 60 seconds later revokes that login.
