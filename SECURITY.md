# Security Policy

## Scope

This policy covers the **MCP server for Mealie** (`@daften/mealie-mcp`) only. Vulnerabilities in Mealie itself should be reported to the [Mealie project](https://github.com/mealie-recipes/mealie/security).

This server handles Mealie credentials and personal data, so coordinated disclosure is appreciated.

## Reporting a Vulnerability

Email **dieterblomme@gmail.com** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce
- Any suggested mitigations

You can expect an acknowledgement within **14 days** and a resolution timeline within that response.

Please do not open a public GitHub issue for security vulnerabilities.

## Out of Scope

- Vulnerabilities that require physical access to the machine running the server
- Vulnerabilities in dependencies (report those upstream; open an issue here to prompt a dependency update)
- Self-hosted Mealie configuration issues

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
