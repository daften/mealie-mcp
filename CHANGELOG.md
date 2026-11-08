# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Cookbook tools in a new `cookbooks` group: `list_cookbooks`, `get_cookbook`, `create_cookbook`, `update_cookbook` and `delete_cookbook`. Filters can be given as category, tag, tool or food IDs, or as a raw Mealie query filter.

## [0.1.0-alpha.1] - 2026-11-08

First prerelease, published to the `next` channel. Requires Mealie v3.29.0 or later.

### Added

- Tools for recipes, recipe images and assets, ingredients, foods and units, organizers, shopping lists and meal plans.
- stdio and streamable HTTP transports, and a Docker image.
- HTTP auth modes: per-caller API key (default), server-wide API key, and an opt-in login form.
- Encrypted SQLite token store so logins survive restarts and image updates.

[Unreleased]: https://github.com/daften/mealie-mcp/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/daften/mealie-mcp/releases/tag/v0.1.0-alpha.1
