# Git checkout (development)

Use this setup when contributing to `mealie-mcp` or running a local development build.

## Setup

```bash
git clone https://github.com/daften/mealie-mcp.git
cd mealie-mcp
npm install
npm run build
```

## stdio mode

Create `.env` from `.env.example`:

```bash
MEALIE_URL=https://your-mealie.example.com
MEALIE_API_TOKEN=your-mealie-api-token
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "mealie": {
      "command": "node",
      "args": ["/absolute/path/to/mealie-mcp/dist/index.js"],
      "env": {
        "MEALIE_URL": "https://your-mealie.example.com",
        "MEALIE_API_TOKEN": "your-mealie-api-token"
      }
    }
  }
}
```

Use `npm run dev` instead of `node dist/index.js` during development to skip the build step.

## HTTP mode

```bash
npm run dev -- --transport http
# or after building:
node dist/index.js --transport http
```

See [Docker and API keys](./docker) and [Login form](./login-form) for the auth modes.

## Running tests

```bash
npm test                  # Unit tests
npm run test:watch        # Watch mode
npm run test:integration  # Against a disposable Mealie instance (requires .env.test)
```
