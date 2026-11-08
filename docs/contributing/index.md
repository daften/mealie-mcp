# Development setup

## Clone and install

```bash
git clone https://github.com/daften/mealie-mcp.git
cd mealie-mcp
npm install
```

## Development loop

```bash
npm test             # Run unit tests
npm run test:watch   # Watch mode
npm run build        # Compile TypeScript → dist/
```

Check TypeScript without building: `npx tsc --noEmit`.

## Running in dev mode (no build needed)

```bash
# stdio mode
npm run dev

# HTTP mode
npm run dev -- --transport http
```

Create `.env` from `.env.example` and fill in `MEALIE_URL` and `MEALIE_API_TOKEN`.

## Integration tests

Integration tests hit a live Mealie instance and need an admin token on a disposable instance. Copy `.env.test.example` to `.env.test`, fill in credentials, then:

```bash
npm run test:integration
```

These are skipped in PR CI and run nightly. Run them manually before submitting changes to API-calling code.

## Commit conventions

```
feat:     New tool or feature
fix:      Bug fix
refactor: Code cleanup without behavior change
test:     Add or update tests
chore:    Dependencies, config, scaffolding
docs:     Documentation only
```

Subject line ≤72 characters. No period at the end.

## Releasing a new version

See [CONTRIBUTING.md](https://github.com/daften/mealie-mcp/blob/main/CONTRIBUTING.md#releasing-a-new-version) in the repository for the full release process.
