# stdio

The MCP client starts the server as a local process. Requires Node.js 22.13 or newer.

Create an API token in Mealie under **Profile → API Tokens**, then configure your client:

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

Add `"--read-only"`, `"--preset", "default"` or `"--groups", "recipes,shopping"` to `args` to limit the tools.
