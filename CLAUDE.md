# CLAUDE.md: MayaLib

Standing instructions for Claude Code sessions in this repository. Draft; revise as the project evolves.

## What this is

MayaLib is a lightweight, portable reading assistant for academic research (initial user: an economics PhD workflow). It covers capturing items to read, bibliographic references, notes while reading, and filing and search by keywords, notes and full text. Targets: Mac, iPhone, and Boox (Android e-ink).

**Status:** design phase. No implementation code yet.

**Source of truth for design:** [`docs/design.md`](docs/design.md). Read the relevant sections before making changes. Section 19 (decisions log) and section 20 (open questions) are the quickest orientation.

## Hard rules

1. **No secrets or account-related identifiers in the repository, ever.** That includes OAuth client IDs, tokens, API keys, library folder IDs, email addresses and personal data. Deployment configuration comes from GitHub Actions variables or the uncommitted `config.local.json` (design §16.3). If a change would add any of these, stop and ask.
2. **User data is plain files.** Markdown + YAML, JSON Lines, and original source files are the source of truth. Caches, indexes and ID maps are derived and must be rebuildable from those files.
3. **Round-trip safety.** Readers and writers must preserve unknown fields and values unchanged. Never drop data the code doesn't understand.
4. **Identity by ID.** Links and references use permanent internal IDs (ULIDs), never paths, titles or citation keys. Citation keys are never regenerated automatically.
5. **Format changes are deliberate.** Adding fields or taxonomy terms is fine. Renaming or removing them, or changing their meaning, requires bumping `formatVersion` and writing an explicit migration (design §17). Taxonomy terms are deprecated, never deleted.
6. **Only the storage adapter knows about Google Drive.** Every external service goes through the capability/provider interfaces (design §4). No Drive-specific code outside the Drive provider.
7. **Every feature must work as a plain PWA on iOS.** There is no paid Apple developer account (D10). Native or wrapped builds are optional enhancements, on Android and macOS only.
8. **Respect restrictions.** Data with `restriction.flows.external: never` must not reach any provider whose `dataLeavesDevice` is true (design §13).
9. **Single-writer files.** Prefer one file per note and per-device logs to minimize sync conflicts. Never merge conflicting edits silently.

## Not yet decided — ask before choosing

- The UI framework, build tooling and search engine (design §20.1). Don't introduce a framework or significant dependency without the user's agreement.
- Drive permission scope: `drive.file` vs `drive` (§20.9).
- The static host and its address (§20.8).

## Working practices

- When a decision is made or changed, update `docs/design.md`: the relevant section, the decisions log (§19) and the open questions (§20). Keep the "Changes from Draft N" note at the top current.
- Keep the design doc's examples consistent with the rules above, e.g. no real DOIs or identifiers presented as data.
- Prefer small, focused commits with descriptive messages.
- When code exists: write tests alongside it. Every storage provider must pass the shared conformance suite (design §4.1).

## Repository layout (current)

```
README.md        overview, no-secrets policy, license notice
docs/design.md   design document (source of truth)
LICENSE          Apache-2.0
NOTICE
.gitignore       excludes local config, .env, build output
```
