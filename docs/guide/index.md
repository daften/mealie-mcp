# Getting Started

`mealie-mcp` is an MCP (Model Context Protocol) server that connects any MCP-compatible AI assistant to your [Mealie](https://mealie.io) instance.

## Prerequisites

- A running Mealie instance, **v3.29.0 or later**
- An MCP-compatible AI client (Claude Code, Claude Desktop, or other)
- Node.js 22.13+ (for npm setups) **or** Docker (for the container setup)

## Choose your setup

| Method | Transport | Best for |
|--------|-----------|----------|
| [npm — stdio](/guide/stdio) | stdio | Simplest setup, AI on the same machine |
| [Docker and API keys](/guide/docker) | HTTP + Mealie API token | Shared server, each client sends its own key |
| [Login form](/guide/login-form) | HTTP + OAuth 2.0 | Shared server, people log in with their Mealie account |
| [Git checkout](/guide/git-checkout) | stdio or HTTP | Contributing or local development |

## Nightly builds

Want to test unreleased changes from `develop`? Install a [nightly build](./nightly) via the `@nightly` (npm) or `:nightly` (Docker) tag. A normal install always gives you the latest tagged release.

## How it works

The server exposes Mealie's REST API as MCP tools, and your AI assistant calls them when you ask about recipes, shopping or meal plans.

With 60 tools across 7 groups, you can optionally load only a subset to save context window space. See [Tool filtering](/reference/filtering).
