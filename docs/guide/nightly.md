# Nightly builds (unstable)

Nightly builds let you try unreleased changes from `develop` before they ship in a tagged release. A new nightly is published automatically each night that `develop` has changed.

::: warning Unstable
Nightly builds are not release-tested and may contain breaking or incomplete changes. Don't use them in production. For stable use, install the default (tagged) release instead.
:::

## Install

### npm

```json
{
  "mcpServers": {
    "mealie": {
      "command": "npx",
      "args": ["-y", "@daften/mealie-mcp@nightly"],
      "env": {
        "MEALIE_URL": "https://your-mealie.example.com",
        "MEALIE_API_TOKEN": "your-mealie-api-token"
      }
    }
  }
}
```

The `@nightly` tag is what pins you to the nightly channel. Drop it to return to the latest tagged release.

### Docker

```bash
docker pull ghcr.io/daften/mealie-mcp:nightly
```

## How nightlies are versioned

Each nightly is published as a SemVer pre-release, for example `0.2.2-nightly.20260614T0300`. Because it is a pre-release:

- A normal install with no tag always resolves to the latest **tagged** release — never a nightly. On npm the `latest` dist-tag is never moved to a nightly; on Docker the `:latest` tag is never moved either.
- Version-range installs (for example `^0.2.1`) also skip nightlies, because npm excludes pre-releases from ranges unless you explicitly opt in.

You only ever receive a nightly by explicitly requesting the `@nightly` (npm) or `:nightly` (Docker) tag.

## Going back to a stable build

Reinstall without the nightly tag:

```bash
npx -y @daften/mealie-mcp          # latest tagged release
docker pull ghcr.io/daften/mealie-mcp:latest
```
