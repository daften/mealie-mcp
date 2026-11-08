# MCP server for Mealie — Project Documentation

## Project Overview

An MCP server for [Mealie](https://mealie.io). TypeScript, ESM, strict. Runs over stdio or streamable HTTP, and one HTTP server can serve many users who each act as themselves.

**Current state:** 60 tools across 7 groups, stdio and HTTP transports, three exclusive HTTP auth modes, tool filtering via `--preset`/`--groups`/`--read-only`. Minimum supported Mealie version: **v3.29.0**.

## Build & Test Commands

| Command | What it does |
|---|---|
| `npm run check` | Biome, both typechecks, all tests. Run before every commit |
| `node --test tests/automation/*.node-test.mjs` | Tests for `scripts/` and workflows |
| `npm run build` | Compile to `dist/` |
| `npm run dev -- --transport http` | Run from source with `.env` |
| `npm run test:integration` | Against a disposable Mealie (needs `.env.test`) |
| `npm run docs:dev` | Docs site |

## File Structure

```
src/
├── index.ts      # entry: transport switch, startup
├── args.ts       # CLI flags and tool-filter env vars
├── config.ts     # chooses the HTTP auth mode, startup refusals and warnings
├── http.ts       # health, bearer resolution, stateless MCP handler
├── client.ts     # MealieClient and formatError
├── auth/         # login mode only; loaded dynamically, so other modes never touch SQLite or Express
├── tests/        # Vitest; fixtures/ holds route snapshots
└── tools/
│   ├── recipes.ts  # get_current_user, search_recipes, get_recipe, create_recipe, import_recipe_from_url, update_recipe, duplicate_recipe, mark_recipe_made, rate_recipe, delete_recipe
│   ├── recipe-assets.ts  # set_recipe_image_from_url, upload_recipe_image, delete_recipe_image, upload_recipe_asset
│   ├── ingredients.ts  # parse_ingredients, list_foods, create_food, update_food, merge_foods, delete_food, list_units, create_unit, update_unit, merge_units, delete_unit
│   ├── organizers.ts  # list_categories, list_unused_categories, create_category, rename_category, delete_category, list_tags, list_unused_tags, create_tag, rename_tag, delete_tag, list_recipe_tools, list_unused_recipe_tools, create_recipe_tool, rename_recipe_tool, delete_recipe_tool
│   ├── cookbooks.ts  # list_cookbooks, get_cookbook, create_cookbook, update_cookbook, delete_cookbook
│   ├── shopping.ts  # list_shopping_lists, get_shopping_list, create_shopping_list, rename_shopping_list, delete_shopping_list, add_shopping_items, update_shopping_item, delete_shopping_item, add_recipe_to_shopping_list
│   └── mealplans.ts  # get_mealplans, get_todays_meals, create_mealplan_entry, create_random_mealplan_entry, update_mealplan_entry, delete_mealplan_entry
scripts/          # release, changelog, audit and CI helpers
tests/automation/ # node:test suites for scripts/ and workflows
```

## Tool Filtering

| Preset | Groups | Tools |
|---|---|---|
| `minimal` | recipes | 10 |
| `default` | recipes, shopping, mealplans | 25 |
| `full` | all 7 groups | 60 |

## Auth modes

Exactly one HTTP mode is active, chosen once at startup in `resolveHttpMode`. All of them end with a Mealie token in `requestContext`, so tools never know how the user logged in.

| Mode | Enabled by | Caller sends |
|---|---|---|
| Per-caller key (default) | nothing | their own Mealie API token |
| Server key | `MEALIE_API_TOKEN` | nothing; any bearer is ignored |
| Login form | `MEALIE_MCP_PASSWORD_LOGIN` | `mcp_at_…` from the OAuth flow |

Login mode never forwards a Mealie key. Mealie has no OAuth server, so this server is the authorization server (the SDK's `mcpAuthRouter` plus `MealieOAuthProvider`). Mealie tokens are encrypted with `MCP_TOKEN_KEY` in SQLite; bearer tokens are stored only as SHA-256 hashes. `resource` in the protected-resource metadata is published without a trailing slash, because Claude compares it with the URL the user typed.

### Adding OIDC

Implement `LoginMethod` (`src/auth/login-method.ts`). Redirect to the identity provider from `begin`, register the callback in `register`, exchange the code at `POST /api/auth/oauth/native/token`, and pass the returned session JWT to `context.completeLogin`. Enable it from `resolveHttpMode` and `index.ts`.

## Testing Strategy

- **Unit tests** in `src/tests/` mock the client and assert the requests each tool sends.
- **Contract test** in `src/tests/mealie-contract.test.ts` calls every tool against a recording client and checks each request's method and path against snapshots of Mealie's route table (`src/tests/fixtures/mealie-routes-<tag>.json`, one for the oldest supported release and one for the newest tested). Refresh with `node scripts/update-mealie-routes.mjs <url>` against that release running.
- **Integration tests** in `src/tests/integration.test.ts` run against a real Mealie (only when `MEALIE_INTEGRATION=true`), including household isolation and the login form. Request *bodies* are only verified here. `nightly.yml` runs them against `mealie:latest`.
- **Docs consistency** in `src/tests/docs-consistency.test.ts` compares the tool lists and counts in the docs with the registered tools.

---

## Branching Model

- **`main`** — default branch, always releasable. Receives only: Dependabot security PRs (auto-merged), manual hotfix PRs, and `release/X.Y.Z` PRs (which carry both the promoted `develop` commits and the release commit — see "Releasing a New Version"). Never commit directly to `main`; `auto-release.yml` is the sole exception, and it is automated and gated.
- **`develop`** — integration branch. All feature PRs and routine dependency bumps target `develop`. The nightly npm/Docker channel builds from `develop`.
- **Every PR in this repo merges as a merge commit — never squash, never rebase.** That applies to feature PRs into `develop`, `release/X.Y.Z` PRs into `main`, back-merges, and automated Dependabot merges alike. Shared history is what keeps back-merges conflict-free; a squash rewrites the commits and makes `main` and `develop` diverge on content they actually share.
- **Every PR is linked to an issue.** Open or find the issue first and put `Fixes #N` in the PR body. GitHub only links a PR to an issue, and closes the issue on merge, when the PR targets the default branch (`main`). A PR into `develop` gets neither: the issue's timeline shows the mention, but its "Development" field stays empty and it stays open. So when a PR into `develop` merges, close its issues by hand with a comment naming the PR, or link them in the PR's "Development" sidebar.
- **Dependabot reads `.github/dependabot.yml` from the default branch (`main`) only.** Changes to it sitting on `develop` govern nothing until they are promoted — until then Dependabot keeps following whatever `main` says. The same applies to the `security-fixes` grouping and the `target-branch` retargeting.
- After every push to `main`, `backmerge.yml` merges `main` into `develop` and pushes directly, so `develop` stays a superset of `main`. No PR is involved on the clean path — `develop` has no required status checks, so a PR there would be opened and merged seconds later for nothing. It pushes with `RELEASE_TOKEN` rather than `GITHUB_TOKEN` so `develop`'s push CI actually runs, uses `--no-ff` so the back-merge is a merge commit like everything else, and retries up to three times in case a feature PR lands on `develop` between its fetch and its push.
- **`CHANGELOG.md` has a `merge=union` driver in `.gitattributes`.** Releases and feature PRs both edit the top of the file (`## [Unreleased]` on one side, a freshly-cut `## [X.Y.Z]` section on the other) — without it, that pattern conflicts on nearly every back-merge. Union merge keeps both sides' additions instead of raising a conflict, so this resolves automatically. **A back-merge PR appearing means git couldn't do that** — a conflict outside that pattern (e.g. a real edit collision) — and needs manual resolution: that's the only path that opens one, and the job fails so it surfaces. Resolve by keeping both sides. Still, one push to `main` means one back-merge, which is why a release is shaped as a single `release/X.Y.Z` PR rather than a promotion merge followed by a release commit.
- **The union driver resolves cleanly but not correctly, so `scripts/changelog-guard.mjs` checks the result.** Union concatenates conflicting *lines*; it has no idea which release section a bullet belongs to. Three shapes have actually occurred, every one reported by git as a clean merge: a stale branch replaying its changelog snapshot into an already-published section (sometimes duplicating an entry verbatim); a back-merge absorbing `develop`'s pending `[Unreleased]` entries into the dated section that just shipped, so the release claims changes it never contained *and* those entries vanish from every future release's notes; and two branches each adding a `### Fixed` heading, leaving two of them. A fourth shape is a real (non-union) three-way merge: a `release/X.Y.Z` PR landing on `main` while another release is also in flight can interleave both dated sections with no blank line between them and duplicate a `[label]:` link definition, which CommonMark then resolves to the wrong one. The guard enforces that **released sections are immutable** — each is compared against the newest tag prior to `HEAD` (or, in `backmerge.yml`, against `origin/main`'s pre-merge `CHANGELOG.md`), not against the base branch — that dated sections stay in strictly descending version order, that no `[label]:` link definition repeats, and that no still-editable section has a duplicate heading. It runs in `ci.yml` on pull requests *and* pushes (back-merges reach `develop` without a PR), in `backmerge.yml` itself before it ever pushes to `develop`, and again in `publish.yml`'s `verify` job, since the GitHub Release body is extracted from these sections. A deliberate, reviewed edit to a published section (a typo fix, a credit line) needs its version added to `scripts/changelog-guard-allowed-edits.json` in the same PR — the exemption then lives in the repo and every later run honors it, unlike `[skip changelog-guard]` in a PR title, which only silences the one `pull_request` run and leaves every subsequent push, nightly, and publish run with no title to read a skip from. Already-published duplicate headings are left alone on purpose — `0.4.6` shipped with two `### Security` headings, and the immutability rule forbids the fix.

### Automated security releases

Routine dependency-CVE fixes ship with no human in the loop:

1. Dependabot opens a **grouped** security PR against `main` (`security-fixes` group in `dependabot.yml`).
2. `auto-merge.yml` enables auto-merge (merge commit); branch protection's required checks gate the merge. `dependabot/fetch-metadata` verifies the PR author and signed first commit and supplies dependency metadata. `scripts/security-pr-alerts.mjs`, loaded from the trusted PR base commit, separately queries all pages of GitHub vulnerability alerts and matches npm alerts by package, manifest path, and previous version across every grouped dependency. It accepts bare exact versions and `= `-prefixed versions; unknown ranges fail closed. The action's built-in lookup assumes the prefix and can miss valid alerts. `RELEASE_TOKEN` needs **Dependabot alerts: Read only** in both the Actions and Dependabot secret stores. Matching retains the previous workflow’s OPEN, FIXED, and DISMISSED alert states. The metadata step continues to use `RELEASE_TOKEN` as established in commit `54a05ba`. API failures and a successful lookup with no matching advisory have distinct diagnostics; an empty match is not proof of a token problem. Auto-merge is tied to the event's head SHA to avoid merging a different revision after a concurrent push.
   - **Auto-merge waits for the required checks even though `RELEASE_TOKEN` can bypass them.** The `main` ruleset lets the admin role bypass its required checks (`auto-release.yml`'s direct push to `main` needs that), and `RELEASE_TOKEN` acts as the owner. Verified on fireflyiii-mcp#111 (2026-09-29): auto-merge was enabled at 07:18:59 while three required checks were still running, they finished by 07:19:15, and the PR merged at 07:19:50. ([#59](https://github.com/daften/mealie-mcp/issues/59))
   - **Keep the ruleset's required check names in step with `ci.yml`.** It requires `test (node 22)`, `test (node 24)`, `test (node 26)` and `audit` by name. When the Node matrix changes, update the ruleset in the same change: a required check that never reports leaves every security PR waiting forever, and the only signal is `nightly.yml`'s `strict-audit` job staying red, because the fix never reaches `develop`.
3. On merge, `auto-release.yml` fires. Because merges are merge commits, it identifies these pushes by the merge subject `Merge pull request #N from daften/dependabot/…` — creating a branch under that name requires push access to the repo, which is a stronger gate than commit authorship (the head commit is authored by whoever merged, and a commit's author field is only a git config value anyway). It bumps the patch version, writes the `### Security` changelog section (via `scripts/release-changelog.sh`), commits `chore(release): X.Y.Z`, tags `vX.Y.Z`, and pushes both with the `RELEASE_TOKEN` PAT (a plain `GITHUB_TOKEN` push would not trigger downstream workflows).
   - The changelog bullet is **line 3 of the merge commit** — the merged PR's title, because the repo's `merge_commit_message` setting is `PR_TITLE`. If that setting is ever changed, the workflow fails loudly (a guard rejects any line 3 that is not a `chore(deps…` subject) instead of shipping a `Merge pull request #N` bullet. Fixing it means restoring the setting, not editing the workflow.
4. The tag push runs `publish.yml`'s normal release path (npm `latest`, Docker semver/`latest`, GitHub Release).

Manual (non-Dependabot) hotfixes: PR to `main`, merge, then cut the release manually per "Hotfix releases" below — `auto-release.yml` only fires on Dependabot merges. Don't rely on Dependabot to catch every advisory: GitHub can publish a reviewed npm advisory without ever raising a Dependabot alert for a repo whose dependency graph lists the vulnerable version, and then no security PR is opened. The nightly `strict-audit` job is the backstop — when it goes red with no open Dependabot PR, fix it by hand as a hotfix to `main`.

The PR audit check is **relative** (`scripts/audit-compare.sh`: no new moderate+ advisories vs the base branch) so a partial security fix stays mergeable; the strict absolute audit runs in `nightly.yml` and alerts without blocking.

---

## Releasing a New Version

`CHANGELOG.md` is the single source of truth. Contributors add entries under `## [Unreleased]`; releases promote that section to a dated version. The publish workflow validates the changelog before publishing, and the GitHub Release body is generated by extracting the matching `## [X.Y.Z]` section from `CHANGELOG.md` (the `release` job's "Extract changelog section" step) — `softprops/action-gh-release` does **not** read the git tag annotation into the release body, so the body must be supplied explicitly via `body_path`.

**Which branch each step happens on matters.** `## [Unreleased]` accumulates on `develop`. The dated `## [X.Y.Z]` section and the `package.json` version bump are created on a short-lived `release/X.Y.Z` branch cut from `develop`, and reach `main` through a single PR — never committed to `develop`, never committed straight to `main`. A version section sitting on `develop` would claim a release that hasn't shipped, and since `backmerge.yml` carries `main` back into `develop` afterwards, promoting on `develop` would make that back-merge conflict with itself.

The release branch also keeps `main` at **one push per release**. `backmerge.yml` fires on every push to `main`, so promoting and then committing the release on `main` runs it twice for one release; folding both into a single PR runs it once. (The tag push doesn't trigger it — `backmerge.yml` watches branches, not tags.) It also means the release commit gets CI and a reviewable diff like everything else, leaving `auto-release.yml` as the only thing that commits directly to `main`.

1. **Reconcile `## [Unreleased]` on `develop` against the actual git history first** — don't assume contributors kept it current. Run `git log v<last>..HEAD --oneline` (and `git diff --stat v<last>..HEAD`) and confirm every user-facing change is represented, paying special attention to security fixes. Routine dev-dependency / CI dependabot bumps are conventionally omitted; runtime-dependency or security-relevant bumps are not. Commit any missing entries to `develop` before cutting the release branch.
   - **Credit external contributors.** For any entry that came from a PR by someone other than the maintainer (skip dependabot and AI co-authors), append `_Contributed by [@handle](https://github.com/handle) in [#PR](https://github.com/daften/mealie-mcp/pull/PR)._` to that bullet. Use explicit markdown links, not bare `@mentions` — the changelog also renders on the VitePress docs site, where `@mentions` and `#refs` do not auto-link. The release notes are extracted from this section, so the credit carries through to the GitHub Release automatically.
2. Cut the release branch from `develop`: `git checkout -b release/X.Y.Z origin/develop`.
3. Move items from `## [Unreleased]` in `CHANGELOG.md` to a new `## [X.Y.Z] - YYYY-MM-DD` section, leaving an empty `## [Unreleased]` heading behind. Update the link references at the bottom of the file. Pick the version from what the section actually contains — any new feature makes it a minor bump, not a patch.
4. Bump `version` in `package.json` (`src/server.ts` reads the version at runtime), then `npm install --package-lock-only` to carry the bump into `package-lock.json`.
5. Run `npm run build` and commit the version bump + changelog promotion together as `chore(release): X.Y.Z`.
6. Open a PR `release/X.Y.Z` → `main` and merge it as a merge commit once checks pass. This is the only push `main` receives for the release, and it carries both the promoted `develop` commits and the release commit.
7. Create an annotated git tag on the resulting merge commit on `main`, with the `## [X.Y.Z]` block from `CHANGELOG.md` as its message (a git-native record of what shipped). The publish workflow validates that this section exists before publishing; it reads the version from the changelog, so tagging a merge commit rather than the release commit is fine.
8. Push the tag: `git push origin v<version>` — this triggers the publish workflow, which validates the changelog, runs tests, publishes to npm + GHCR, and creates a GitHub Release whose notes are extracted from the matching `CHANGELOG.md` section.
9. `backmerge.yml` merges the released section straight back into `develop`. `CHANGELOG.md`'s `merge=union` driver resolves the usual case automatically even if `develop` has already collected new `[Unreleased]` entries; a back-merge PR only appears if git still can't reconcile it, and that needs manual resolution. Delete the release branch once it's merged.

### Hotfix releases

A manual hotfix (a fix merged straight to `main`, typically a dependency CVE Dependabot didn't raise) ships through the same `release/X.Y.Z` → `main` PR and tag, with these differences:

1. **Land the fix on `main` first** — a PR from a branch cut from `origin/main`, with its bullets under `## [Unreleased]` in `main`'s `CHANGELOG.md`. Change only what the fix needs: for a transitive dependency, update just the vulnerable lockfile entries (`npm update <pkg>`) rather than `npm audit fix`, which refreshes unrelated packages too.
2. **Back-merge the fix before releasing.** If `develop`'s `[Unreleased]` already has a heading the fix adds (typically `### Security`), the union merge leaves two of them, `changelog-guard` rejects the result, and `backmerge.yml` opens a back-merge PR whose head is `main` — which can't be edited. Resolve it on a branch cut from `origin/develop`: `git merge --no-ff origin/main`, fold the bullets under `develop`'s existing heading, and PR that into `develop`. The automated PR is marked merged once `develop` contains `main`.
3. **Cut the release branch from `main`, not `develop`** (`git checkout -b release/X.Y.Z origin/main`), so the release contains only the hotfix and none of `develop`'s unreleased work. Promote `main`'s `[Unreleased]` and bump the patch version as in steps 3–5 above, then PR, merge, tag and push the tag as in steps 6–8.
4. **Expect the post-release back-merge to fail too** whenever `develop` has pending `[Unreleased]` entries: the union merge splices them into the section that just shipped, and the guard rejects the edit to a released section. Resolve it the same way as in step 2, but make the released `## [X.Y.Z]` section identical to the tag (`git show vX.Y.Z:CHANGELOG.md`), remove the bullets that just shipped from `develop`'s `[Unreleased]`, keep `develop`'s own pending entries there, and add the `[X.Y.Z]:` link reference. `node scripts/changelog-guard.mjs` must report the file consistent with the new tag before you push.

### Prerelease releases (alpha / beta / rc)

A prerelease ships through the normal `release/X.Y.Z-alpha.N` → `main` PR and tag flow above; only the version string and what the tag publishes differ. `scripts/release-version.mjs` is the single place that decides what a version means, and `publish.yml`, `auto-release.yml` and `changelog-guard.mjs` all go through it or share its rules.

- **The vocabulary is closed: `X.Y.Z-alpha.N`, `X.Y.Z-beta.N`, `X.Y.Z-rc.N`, with a dot and a number without leading zeros.** Anything else (`-alpha1`, `-dev.1`, `-foo.2`, `-1`) fails the tag push before anything is published. The dot matters: semver compares `alpha.2 < alpha.10` numerically, but the single identifier `alpha10` sorts *before* `alpha2`. The three stages sort in maturity order on their own (`alpha < beta < rc < stable`). Tag it `vX.Y.Z-alpha.N`; the changelog section is `## [X.Y.Z-alpha.N]` and it gets a link reference like any other.
- **One prerelease channel, `next`, not one per stage.** `next` is "the newest tagged release of any kind". A prerelease moves it, and so does a stable release that is newer than every existing tag, so `@next` never trails `@latest`.
  - npm: a prerelease publishes with `--tag next` and never touches `latest`; install with `npm i @daften/mealie-mcp@next`.
  - Docker: a prerelease pushes `:X.Y.Z-alpha.N` and `:next`; `:latest`, `:X` and `:X.Y` keep pointing at the newest stable image. A stable release that is the newest tag also pushes `:next`.
  - GitHub Release: marked a pre-release and never the repository's "latest release".
- **`next` only moves forward.** `is-newest` compares the tag being released with every existing `v*` tag. A stable hotfix on an old line (`0.5.7` while `1.0.0-rc.1` exists) leaves `next` alone, and a prerelease older than an existing tag (`1.0.0-rc.2` after `1.0.0`) is refused outright.
- **Moving `next` on a stable release is a separate npm call** (`npm dist-tag add`), which trusted publishing only performs when the package's trusted-publisher config has the "Allow npm dist-tag" permission enabled. The step is `continue-on-error`: the release stays good if it is missing, and the run prints the command to run by hand: `npm dist-tag add @daften/mealie-mcp@X.Y.Z next`.
- **`auto-release.yml` refuses to run while `package.json` is a prerelease** (`npm version patch` on `1.0.0-alpha.1` yields the stable `1.0.0`, so an unattended security release would publish it by accident). The workflow fails loudly on the Dependabot merge; cut that release by hand, as the next prerelease or as the stable version.
- **Graduating:** the next release branch sets `version` to `X.Y.Z` and adds `## [X.Y.Z]`. The prerelease sections stay below it, immutable like any other.
- **Nightlies** are a different channel (`develop`, never tagged) and keep working: on a prerelease `package.json` the nightly version is `X.Y.Z-nightly.<stamp>`, which sorts after every `X.Y.Z-alpha.*` and before `X.Y.Z`.
- `changelog-guard` orders sections and picks its baseline tag by semver precedence (`1.0.0-alpha.1 < 1.0.0-rc.1 < 1.0.0`) rather than git's version sort, which ranks `v1.0.0-alpha.1` *above* `v1.0.0`.

### Nightly builds

Nightly publishing lives in the **same `publish.yml` workflow** as tagged releases — deliberately, because npm trusted publishing (OIDC) allows only one trusted-publisher workflow file per package, so both channels must publish from `publish.yml` to share that config (no `NPM_TOKEN` needed). A `setup` job resolves the *channel* per run:

- **release** when triggered by a `v*` tag push (`github.event_name == 'push'`);
- **nightly** when triggered by the `0 3 * * *` UTC cron or manual `workflow_dispatch` (with an optional `force` input).

`setup` outputs `sha`, `channel`, `should_publish`, `version`, and `npm_tag`; the downstream `verify` / `publish-npm` / `publish-docker` / `release` jobs are single-copy and parameterized by those outputs (Docker uses `metadata-action`'s per-tag `enable=` to select release vs nightly tags).

Every downstream job builds the one commit `setup` resolved (`sha`), so a push to `develop` mid-run cannot publish a commit `verify` never tested. Each job checks out the same trusted ref as `setup` (the tag, or `develop`), then a "Pin to the commit setup resolved" step runs `git merge-base --is-ancestor` to confirm `sha` is on that ref before checking it out. Keep that shape: passing `sha` straight to `actions/checkout`'s `ref` fails CodeQL's `actions/cache-poisoning/poisonable-step`, which treats any job output named like a SHA as an untrusted pull request head.

For the nightly channel `setup` also runs the change-guard: it publishes only when `develop`'s HEAD differs from the commit the rolling `nightly` git tag points at (so it builds only on nights `develop` changed; `force=true` bypasses). A nightly run:
- computes a prerelease version `<next-patch>-nightly.<UTCstamp>` (in-CI only, never committed);
- publishes to npm under the **`nightly`** dist-tag — the `latest` dist-tag is never touched;
- pushes Docker tags `:nightly` and `:nightly-YYYYMMDD` to `ghcr.io` — `:latest` is never touched;
- force-moves the `nightly` git tag to HEAD and updates a GitHub pre-release (`prerelease: true`, `make_latest: false`).

This is independent of `nightly.yml` (Mealie integration tests), which is a separate workflow.

---

## Commits

After every meaningful work step, commit with a `Co-Authored-By` trailer reflecting the specific AI assistant model and design team that authored the change:

```bash
git add [files...]
git commit -m "[type]: [subject]

Co-Authored-By: [Agent model used] <[domain]>"
```

Use the correct developer attribution matching the model's originating company:
* **Anthropic / Claude commits:** Use `noreply@anthropic.com` (e.g., `Co-Authored-By: Claude Sonnet 3.5 <noreply@anthropic.com>`)
* **Google / Gemini commits:** Use `noreply@google.com` (e.g., `Co-Authored-By: Gemini 1.5 Pro <noreply@google.com>`)
* **OpenAI / GPT commits:** Use `noreply@openai.com` (e.g., `Co-Authored-By: GPT-4o <noreply@openai.com>`)

**Commit types:**
- `feat:` New tool or feature
- `fix:` Bug fix
- `refactor:` Code cleanup without behavior change
- `test:` Add or update tests
- `chore:` Dependencies, config, scaffolding
- `docs:` Documentation only

---

## Security & Open Source

- **No hardcoded secrets.** All credentials come from environment variables.
- **Validate all input.** Use Zod schemas in each `defineTool()` call. Any value that becomes part of a URL path needs a validating schema (`slugSchema`, `idSchema`). `assertSafeApiPath` in `MealieClient` is the backstop.
- **Error handling.** Every tool goes through `defineTool`, which returns `{ isError: true }` on failure.
- **Never log request bodies on auth routes.** Never write to stdout in stdio mode.
- **Dependencies.** Keep them minimal and up-to-date.
- See `SECURITY.md` for the vulnerability disclosure policy.

---

## Development Notes

- Every tool uses an annotation from `_annotations.ts`. Read-only filtering relies on those annotations.
- Tool inputs are `snake_case` and map to Mealie's `camelCase` in the handler.
- Mealie PUT routes usually want the whole object: use `mergePut` for partial updates.
- **Ratings are per user.** A `rating` sent with a recipe is silently ignored, so `rate_recipe` posts to `/users/{id}/ratings/{slug}`.
- Unknown flags and env values are errors, never silently ignored.
- New schema changes are appended to `MIGRATIONS` in `src/auth/store.ts`; existing entries never change.
- Use ESM imports with the `.js` extension, and a single merged import from each module.
- `dist/` is gitignored. Run `npm run build` before running or deploying.
- The minimum supported Mealie version is **v3.29.0**: the oldest release that serves every route the tools call. `/organizers/tools/empty` is what sets it.
- **Internal planning docs are local-only.** They live in `docs/superpowers/` (gitignored, and `srcExclude`d from the VitePress site) and must never be committed.

---

## Useful Resources

- Mealie API: `/docs` and `/openapi.json` on any instance
- [Mealie documentation](https://docs.mealie.io/)
- [MCP Documentation](https://modelcontextprotocol.io/)
