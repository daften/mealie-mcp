# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Every tool now rejects unknown parameters with an error that names the unknown key and lists the valid ones. Before, a typo such as `query` for `search` was silently dropped, so `search_recipes` returned every recipe.

## [0.1.0] - 2026-11-08

First stable release. It is the same code as 0.1.0-alpha.2, now published as `latest`. Requires Mealie v3.29.0 or later.

### Added

- 58 tools in seven groups: recipes, recipe images and assets, ingredients, organizers, cookbooks, shopping lists and meal plans.
- stdio and streamable HTTP transports, and a Docker image.
- HTTP auth modes: per-caller API key (default), server-wide API key, and an opt-in login form.
- Tool filtering with `--preset`, `--groups` and `--read-only`.

## [0.1.0-alpha.2] - 2026-11-08

### Added

- Cookbook tools in a new `cookbooks` group: `list_cookbooks`, `get_cookbook`, `create_cookbook`, `update_cookbook` and `delete_cookbook`. Filters can be given as category, tag, tool or food IDs, or as a raw Mealie query filter.

## [0.1.0-alpha.1] - 2026-11-08

First prerelease, published to the `next` channel. Requires Mealie v3.29.0 or later.

### Added

- Tools for recipes, recipe images and assets, ingredients, foods and units, organizers, shopping lists and meal plans.
- stdio and streamable HTTP transports, and a Docker image.
- HTTP auth modes: per-caller API key (default), server-wide API key, and an opt-in login form.
- Encrypted SQLite token store so logins survive restarts and image updates.

[Unreleased]: https://github.com/daften/mealie-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/daften/mealie-mcp/compare/v0.1.0-alpha.2...v0.1.0
[0.1.0-alpha.2]: https://github.com/daften/mealie-mcp/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/daften/mealie-mcp/releases/tag/v0.1.0-alpha.1
