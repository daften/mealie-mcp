# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- In login mode, the OAuth and login routes now send the standard security headers (HSTS, `X-Content-Type-Options`, `X-Frame-Options` and others) through `helmet`. The login page keeps its own stricter policy, and there is no `Cross-Origin-Opener-Policy`, so clients that log in through a popup keep working.
- `scripts/update-mealie-routes.mjs` checks the whole version string a Mealie server reports before using it in the output file name, so a server can no longer make it write outside `src/tests/fixtures/`.
- Workflows no longer leave the checkout's Git credentials on the runner, except in the two jobs that push.

## [1.0.0] - 2026-11-11

Same code as 0.1.1, which has been running in production since its release. From this version, the tool names, parameters and configuration follow semantic versioning: a breaking change needs a major version. Requires Mealie v3.29.0 or later.

## [0.1.1] - 2026-11-08

### Added

- `merge_foods` and `merge_units` merge a duplicate into another entry and move its ingredients across, so recipes keep their links. `delete_food` and `delete_unit` point to them.
- `create_unit` and `update_unit` take `plural_abbreviation`, `use_abbreviation` and `fraction`, so a unit can show "1 kg" and a decimal quantity instead of "1 4/5 kilograms". Foods and units take `aliases`.

### Changed

- `create_recipe` and `update_recipe` return a short summary (id, slug, name, servings, total time, tags, ingredient count, rating, whether it has an image) instead of the whole recipe. `get_recipe` still returns everything.
- Sharper tool descriptions: ingredient `food` and `unit` need an id and name from `list_foods` / `list_units`, quantities are decimals, unparsed text goes in `note`, `total_time` is never derived from prep and cook time, ratings are per user, and `search_recipes` filters take IDs or slugs and mean "any" unless `require_all` is set. `import_recipe_from_url` says what happens when a site blocks the scraper, and `parse_ingredients` says it creates nothing.

### Fixed

- Releases of a stable version now install npm 11.21.0 before moving the `next` dist-tag. With npm's bundled version, the step failed with `E401` even though the trusted publisher allowed dist-tag changes.
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

[Unreleased]: https://github.com/daften/mealie-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/daften/mealie-mcp/compare/v0.1.1...v1.0.0
[0.1.1]: https://github.com/daften/mealie-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/daften/mealie-mcp/compare/v0.1.0-alpha.2...v0.1.0
[0.1.0-alpha.2]: https://github.com/daften/mealie-mcp/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/daften/mealie-mcp/releases/tag/v0.1.0-alpha.1
