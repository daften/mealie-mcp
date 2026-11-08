---
layout: home

hero:
  name: mealie-mcp
  tagline: Connect any MCP-compatible AI assistant to your Mealie recipes, shopping lists and meal plans.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: GitHub
      link: https://github.com/daften/mealie-mcp
    - theme: alt
      text: Docker (GHCR)
      link: https://github.com/daften/mealie-mcp/pkgs/container/mealie-mcp

features:
  - icon: 🛠️
    title: 53 tools
    details: 6 groups covering recipes, images and assets, ingredients, organizers, shopping lists and meal plans.
  - icon: 🔌
    title: stdio & HTTP
    details: Connect locally with an API token, or self-host one server for a whole household.
  - icon: 👥
    title: Per-user access
    details: Each person acts as their own Mealie user, with an API key or an optional login form.
  - icon: 🐳
    title: Docker ready
    details: Run as a self-hosted container, with logins kept on a persistent volume.
---

## What you can ask

> *"What can I make with leeks and potatoes?"*

> *"Plan dinners for next week and add what I need to my shopping list."*

> *"Import this recipe from a URL and tag it as weeknight."*

## Quickstart

Create an API token in Mealie under **Profile → API Tokens**, then add to your MCP client config:

```json
{
  "mcpServers": {
    "mealie": {
      "command": "npx",
      "args": ["-y", "@daften/mealie-mcp"],
      "env": {
        "MEALIE_URL": "https://your-mealie.example.com",
        "MEALIE_API_TOKEN": "your-mealie-api-token"
      }
    }
  }
}
```

## All setup options

| Method | Transport | Best for |
|--------|-----------|----------|
| [npm — stdio](/guide/stdio) | stdio | Simplest setup, AI on the same machine |
| [Docker and API keys](/guide/docker) | HTTP + Mealie API token | Shared server, each client sends its own key |
| [Login form](/guide/login-form) | HTTP + OAuth 2.0 | Shared server, people log in with their Mealie account |
| [Git checkout](/guide/git-checkout) | stdio or HTTP | Contributing or local development |

**Using Claude Desktop?** Its config file accepts stdio servers only. See [Claude Desktop](/guide/claude-desktop).
