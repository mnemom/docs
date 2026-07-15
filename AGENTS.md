# AGENTS.md — docs

You are a coding agent working on the **Mnemom documentation site**
(docs.mnemom.ai). Audience: AI coding tools (Claude Code, Cursor,
Cline, Aider) and humans onboarding via them.

## What this repo is

The Mintlify-powered documentation site at
[docs.mnemom.ai](https://docs.mnemom.ai). All content is MDX/MD;
Mintlify renders it, hosts it, and auto-deploys on push to `main`.

Key fact for agents: Mintlify ships agent-readability features by
default — `Accept: text/markdown` content negotiation, `<path>.md`
URLs, auto-generated `/llms.txt` + `/llms-full.txt`, and discovery
headers (`Link rel="llms-txt"`, `X-Llms-Txt`). This is named
publicly as commitment #8 on https://www.mnemom.ai/for-agents/ and
verified nightly by the watchdog.

## Stack

- **Mintlify** — `docs.json` is the single config file (theme,
  navigation, branding, integrations).
- **MDX/MD** — pages are `.mdx` (full Mintlify components) or `.md`
  (plain markdown).
- **OpenAPI specs** — the customer-facing slice is served live from
  `https://api.mnemom.ai/openapi.json`, but the canonical ADR-054 intent is
  the **committed-snapshot** one: `api-reference/openapi.json` IS committed
  (source of truth for the generated pages) and re-synced from the live
  surface by `scripts/sync-openapi.mjs`. Drift is DETECTED — git-diffed by
  `.github/workflows/openapi-freshness.yml` and by
  `scripts/check-slice-freshness.mjs` — not "impossible by construction".
- No package.json, no build step. Mintlify handles everything.

## Local preview

```bash
# Mintlify CLI (one-time install)
npm i -g mintlify

# From repo root
mintlify dev               # serves docs locally with hot reload
mintlify broken-links      # report broken internal links
```

## Project layout

```
docs.json                  # Mintlify config — navigation, theme, redirects
introduction.mdx           # Top-level intro page
concepts/                  # Concept pages (alignment-card, AP-trace, etc.)
protocols/                 # AAP, AIP, CLPI specs
specifications/            # Normative schemas (alignment-card, policy DSL, OTel)
api-reference/             # Auto-generated from OpenAPI; openapi.json/yaml lives here
quickstart/                # Five-minute integration paths
guides/                    # Long-form how-tos
gateway/                   # Gateway-specific docs
for-agents/                # Second-person agent-facing tab (mirrors www agents.txt)
pricing/
changelog.mdx
fonts/, images/, logo/     # Static assets
scripts/                   # Tooling (currently: OpenAPI drift check)
agents.txt                 # Mirror of /for-agents agent pitch (also at root)
```

## Conventions

- **`docs.json` is the config contract.** Adding/removing/reordering
  pages happens here. Mintlify renders 404s for orphaned files, so
  every `.mdx` should be reachable from `docs.json`'s navigation.
- **One H1 per page.** Mintlify uses the page title from the MDX
  frontmatter or the first H1 — pick one, be consistent.
- **`api-reference/` is generated** from the OpenAPI spec. Hand-
  editing pages there will be overwritten. Edit the spec, regenerate.
- **`for-agents/` mirrors the second-person tone of agents.txt on
  www.mnemom.ai.** Keep them aligned in voice.
- **Internal links use absolute paths** (`/concepts/foo`), not
  relative paths.
- Commit messages: imperative, concise, describe the **why**.

## Branch protection + deploy

- Never commit directly to `main`. Always feature branch first.
- Branch protection enforced.
- **Mintlify auto-deploys on push to `main`** — no orchestrator, no
  approval gate. A merge ships docs immediately. Be deliberate.
- Pre-merge: run `mintlify broken-links` locally.

## What you should NOT do

- Don't hand-edit `api-reference/` pages — they're generated.
- Don't add a custom build step. Mintlify is the build.
- Don't relicense.
- Don't break the agent-facing surfaces — `Accept: text/markdown`,
  `.md` URLs, `/llms.txt`, `/llms-full.txt`, the discovery headers.
  These are public commitments (#8 on /for-agents) verified nightly.
- Don't merge a PR with `mintlify broken-links` failures.
- Don't `git push --force` to `main`.

## Cross-links

- **Live site**: https://docs.mnemom.ai
- **Auto-generated indexes**: https://docs.mnemom.ai/llms.txt and
  /llms-full.txt
- **Marketing site companion**: https://www.mnemom.ai/for-agents/
  (which depends on this site staying agent-friendly — commitment #8).
- **Mintlify config docs**: https://www.mintlify.com/docs
