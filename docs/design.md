# MayaLib — Design Document (Draft 3)

*Status: draft for review · Last updated 2026-11-25*

**Since Draft 3:** decisions D14–D21 resolve most open questions: Spike 0 defined (D19); hosting on Cloudflare at `mayalib.org` (D20); UI in Preact (D21).

**Changes from Draft 2:** platform targets and distribution with no paid Apple developer account (§3.1); web storage and retention limits (§3.2); native and wrapped options considered (§3.3); per-device storage budgets (§5.5).

**Changes from Draft 1:** web pages as sources (§9); per-file extracted text (§9.3); entities as first-class objects (§10); a note-template library (§11); where data lives and how sync works (§5); tiered search (§6); pluggable service capabilities (§4); implementation substrate left open (§20).

## 1. Purpose

MayaLib is a lightweight, portable reading assistant for an academic researcher (the initial target is a PhD student in economics). It supports:

1. Capturing items to be read: papers, books, web pages, talks, datasets, …
2. Creating and exporting bibliographic references
3. Collecting notes, highlights and structured extracts while reading
4. Filing and searching by keywords, notes, and full text

Source documents can be **PDFs, EPUBs, or web pages**. Web pages are captured and stored locally as dated snapshots that record their source URL (§9.2).

It runs on a MacBook, an iPhone, and a Boox (Android e-ink) reader.

### Non-goals

- Writing papers (LaTeX/Overleaf), managing data or code (Git, Dropbox), or authoring slides (Beamer). MayaLib links to and exports into these tools; it does not replace them.
- Multi-user collaboration. MayaLib is single-user. Sharing happens through exports.

## 2. Design principles

1. **The files are the source of truth.** All user data is plain text (Markdown + YAML, JSON Lines) plus original source files. The data must stay usable with no copy of MayaLib installed.
2. **Everything else is derived and rebuildable.** Caches, indexes and ID maps can be deleted at any time and rebuilt from the files.
3. **Storage and services are swappable.** Storage, search, text extraction, OCR, metadata lookup, web capture and AI are each a defined *capability* with interchangeable providers (§4). No feature may depend on something only Google Drive can provide.
4. **Unknown data is preserved.** Every reader and writer keeps fields and values it doesn't recognize and writes them back unchanged.
5. **Each file has a single writer wherever possible.** One file per note, one history log per device, and one designated device for each shared derived file.
6. **Identity never depends on names.** Links and references use permanent internal IDs, never paths, titles, display names or citation keys.
7. **Taxonomies and templates are data.** They live in the library, are namespaced, and can be extended by the user.
8. **Search results state their coverage.** When results are incomplete, the UI says what was searched and what wasn't.

## 3. Architecture

```
UI (installable PWA; e-ink-friendly mode)
 └─ Library        items, entities, collections, notes, links, citations
     ├─ Format     on-disk spec ⇄ objects. Pure functions, versioned, round-trip safe
     ├─ Search     tiered: core index + full-text sources (§6)
     ├─ Content    source files, snapshots, extracted text; cached on demand (§5)
     └─ Sync       core mirror, content cache, outbox, change feed (§5)
         └─ Capability registry (§4)
              storage · rangeRead · remoteSearch · extract · ocr · metadata ·
              entityLookup · webCapture · archive · encrypt · ai · alerts
```

### 3.1 Platform targets and distribution

**Constraint: no paid Apple Developer Program membership.** On iOS, any native app or wrapped web app must be code-signed. With only a free Apple ID, a self-installed app stops working after 7 days until it is reinstalled, so the iPhone version must be a plain PWA. Every feature must work in the plain PWA on iOS. Native shells are optional extras, and only on Android and macOS.

| Device | Form | Distribution | Notes |
|---|---|---|---|
| iPhone | PWA installed to the Home Screen | URL | Required, not optional: Home Screen apps are exempt from Safari's 7-day data deletion |
| Boox (Android) | PWA in Chrome; optionally a wrapped app (Capacitor) | APK install | Free. Android developer verification (regional from Sept 2026, global in 2027) has a free limited-distribution tier for hobbyists and personal use, and installing over USB with ADB remains available |
| Mac | PWA (Chrome/Edge install, or Safari "Add to Dock"); optionally a wrapped desktop app (Tauri/Electron) | Built and installed locally | Unsigned apps you build yourself run on your own Mac; macOS may ask for a one-time override |

- **Hosting (app code only, no backend; Cloudflare per D20):** browsers will only install a PWA, run its offline service worker, and complete Google sign-in when the app is loaded from an HTTPS address (or from `localhost`). Opening files copied to the device (`file://`) does not work, and Google Drive no longer serves web pages. So the built app (static HTML/JS/CSS) is published to a free static host: Cloudflare, at `mayalib.org` (D20).
  - The host never sees library data. Devices talk directly to Google Drive.
  - The host is needed only to install the app and to fetch updates; after that the app runs from the device's cache, offline included.
  - Browser storage and the OAuth settings are tied to the address, so choose it early. If the host disappears, installed copies keep working and the app can be republished elsewhere; each device then reinstalls and rebuilds its cache from Drive. No data is lost.
  - Security: whoever can publish to the host controls the code that holds the Google sign-in token, so the hosting account needs strong protection (two-factor authentication).
  - Alternatives that need no host: on the Mac, serve the app from `localhost`; on the Boox, install a wrapped APK with the code bundled. The iPhone is the device that requires the static host.
- **No server, and no central device:** all devices are peers that talk only to the storage provider. No device needs to be reachable on the network, and USB is not needed.
- **Saving web pages on iOS without a native app:** an iOS Shortcut appears in Safari's share sheet. It serializes the page (with a "Run JavaScript on Web Page" action) and saves the files into the library's `inbox/` folder through the Files app's Google Drive location. MayaLib files the inbox contents on its next sync. *To verify: that Shortcuts can write to the Google Drive location in Files, and how large a page it can serialize.* The fallback is a bookmarklet.

### 3.2 Web platform storage and retention constraints

| | iPhone (WebKit, iOS 17+) | Boox / Mac (Chrome) |
|---|---|---|
| Per-origin quota | ~60% of disk for browser apps, ~15% for other apps that embed web content. Plan for 15%, since it's unclear which applies to Home Screen apps | up to 60% of disk |
| Exceeding the quota | writes fail; there is no prompt to grant more space in an installed app | writes fail |
| Clearing when disk is low | possible, unless the app has requested persistent storage | rare in practice; persistent storage prevents it |
| Inactivity deletion | Safari: 7 days without use. Home Screen apps are exempt | none |
| Deleting the app | deletes all its local data | deletes all its local data |
| Background sync | none, syncs only while open | limited; not relied on |

Design rules that follow:

1. Request persistent storage (`navigator.storage.persist()`) when the user first connects a library, in response to a tap.
2. **Unsent changes are the only data at risk.** Upload them immediately; show a visible "unsynced changes" indicator; warn before the user deletes the app or signs out.
3. Treat `QuotaExceededError` as a signal to evict content, never as a fatal error. Show the space used and the quota (`navigator.storage.estimate()`) in settings.
4. Downloading content for offline use on iOS happens only while the app is open. Offer an explicit "Prepare for offline" action, e.g. before a flight.
5. Memory, not disk, limits in-browser search. Keep large indexes on disk (SQLite in the browser's private file storage, OPFS), not in memory.

### 3.3 Native and wrapped options considered

| | PWA | Wrapped web app (Capacitor, Tauri 2) | Native (Flutter) |
|---|---|---|---|
| Codebase | one (web) | one (web) plus small native plugins | one (Dart); the web code is not reused |
| iOS without a paid account | ✓ | ✗ (7-day re-signing) | ✗ (7-day re-signing) |
| Storage | quota; can be cleared | free disk space; the app owns its files | free disk space; the app owns its files |
| Share-sheet capture | Shortcut workaround | native share extension (✓ on Android/Mac; iOS needs signing) | same as wrapped |
| PDF rendering on e-ink | pdf.js (to be benchmarked) | native renderer available | native renderer |
| Search engine | SQLite in WebAssembly (OPFS) | native SQLite | native SQLite |

**Direction:** PWA first. A wrapped build for the Boox (and possibly the Mac) is an optional enhancement, delivered as alternative providers behind the same capability interfaces, e.g. native PDF rendering or a share-target capture provider. Flutter is not pursued: it gives up the shared web codebase, and on iOS it is subject to the same signing constraint.

## 4. Capabilities and providers

Every external dependency is a **capability** with a defined interface. The registry holds one or more **providers** per capability. A provider is one of three kinds:

- **local:** runs on the device (pdf.js extraction, local encryption)
- **backend:** offered by the storage backend (Drive full-text search)
- **external:** a third-party service (Crossref, OpenAlex, an OCR or AI API)

The app degrades gracefully when a capability has no provider.

```ts
interface Provider<C> {
  id: string;                       // "drive.remoteSearch", "local.pdfjs", "openalex.entities"
  capability: CapabilityName;
  kind: "local" | "backend" | "external";
  dataLeavesDevice: boolean;        // checked against restriction flows (§13)
  impl: C;
}
```

| Capability | Required? | Initial provider | Replacement path |
|---|---|---|---|
| `storage` | yes | Drive | Dropbox, WebDAV, S3, local folder (File System Access API on desktop) |
| `rangeRead` | no | Drive (HTTP Range) | most HTTP backends; otherwise download whole file |
| `remoteSearch` | no | Drive `fullText contains` | shared prebuilt index (§6.3) |
| `extract` (text) | yes | local pdf.js, EPUB parser, Readability | — |
| `ocr` | no | none in v1 | Tesseract (wasm, local) or an external OCR API |
| `metadata` | yes | Crossref, Open Library, NBER, arXiv, RePEc | any lookup plugin |
| `entityLookup` | no | OpenAlex, ORCID, ROR | Wikidata, RePEc |
| `webCapture` | yes | bookmarklet / extension (in-page) | iOS Shortcut, Android share target, capture service |
| `archive` | no | none in v1 | Internet Archive "Save Page Now" |
| `encrypt` | no | none in v1 | age / libsodium (local) |
| `ai` | no | none in v1 | any LLM API |
| `alerts` | no | none in v1 | OpenAlex / Crossref polling |

Provider configuration that isn't secret lives in `_config/providers.yaml` and syncs. Credentials (OAuth tokens, API keys) are device-private and never synced.

### 4.1 StorageAdapter

```ts
interface StorageAdapter {
  list(prefix: string): AsyncIterable<FileMeta>;
  read(path: string): Promise<{ bytes: Uint8Array; version: string }>;
  write(path: string, bytes: Uint8Array, opts?: { ifVersion?: string }): Promise<FileMeta>; // throws ConflictError
  remove(path: string, opts?: { ifVersion?: string }): Promise<void>;
  changesSince(cursor?: string): Promise<{ changes: FileChange[]; cursor: string }>;
}
interface RangeReader { readRange(path: string, start: number, end: number): Promise<Uint8Array>; }
```

A shared test suite runs against every storage provider. A provider counts as finished when it passes the suite. An in-memory provider exists for tests.

## 5. Where data lives, and sync

### 5.1 Residency classes

| Class | Contents | Mac (default) | iPhone / Boox (default) |
|---|---|---|---|
| **Core** — always mirrored | `library.yaml`, `_schema/`, `_templates/`, `_config/`, every `item.md`, notes, history logs, collections, ideas, entities | everything | everything |
| **Content** — fetched on demand, cached | source files (PDF, EPUB, web snapshots), extracted text | keep everything | pinned + recently used, within a storage budget |
| **Shared derived** | `_index/` (prebuilt full-text index, bootstrap bundle) | builds it (indexer device) | reads it remotely or downloads it if space allows |
| **Local derived** | local search indexes, path→ID map, thumbnails | yes | yes |
| **Device-private** | settings, credentials, outbox of unsent changes | never synced | never synced |

**Core is small.** Every device holds all of it, so browsing, filing, links and core search (§6.1) are always complete and work offline.

**The "indexer" role is optional and opportunistic.** Whenever the designated device (normally the Mac) happens to be running MayaLib, it rebuilds the shared derived files in `_index/` and uploads them to the storage provider. Other devices only read those files from storage; they never connect to the indexer. If the indexer is offline for weeks, the shared files simply become stale. Other devices then fall back to their local indexes plus `remoteSearch`, and say so in the search coverage line. Nothing breaks, and v1 doesn't need an indexer at all.

### 5.2 Content cache policy (per device)

- **Pinned, never evicted:** items with reading status `reading`; items in collections marked *offline*; items pinned by hand.
- **Recent:** opened within N days (default 30).
- **Budget:** a per-device limit (e.g. 2 GB on the Boox). Beyond it, the least recently used unpinned content is evicted.
- Unsent changes (the outbox) are never evicted.
- Evicting content never changes the library. It only frees space on that device.

### 5.3 Sync mechanics

- **Pull:** on launch, when the app regains focus, and periodically while active. Uses `changesSince(cursor)`. Core files are downloaded immediately; content files are only marked as stale.
- **Push:** changes are written to the local cache and queued in the outbox, then uploaded with `ifVersion`. On `ConflictError`, both copies are kept and the item is flagged for the user. Changes are never merged silently.
- **Bootstrap:** a new device would otherwise need thousands of small API calls. Instead it downloads `_index/core-bundle.jsonl.gz`, a packed copy of all core files built by the indexer device, and then catches up through the change feed. If the bundle is missing or stale, the device falls back to listing files.

### 5.4 Size estimates (rough; to be validated)

| Data | Per item | Library of ~3,000 papers + 300 books |
|---|---|---|
| Core (item.md, notes, history, entities) | 5–20 KB | 15–60 MB |
| Core search index | — | 10–50 MB |
| Extracted text | paper 50–150 KB; book 0.5–1.5 MB | 0.3–0.6 GB |
| Full-text index | ~0.3–1× text size | 0.1–0.5 GB |
| Source files | paper 1–5 MB; book 2–50 MB; scanned book 50–200 MB; web snapshot 0.5–5 MB | 5–20 GB |

Consequences:

- Core and its index fit comfortably on every device.
- A full-text index of everything fits on the Mac but strains a phone or the Boox, hence the tiers in §6.
- Source files for a large library may outgrow Google Drive's free 15 GB, which is also shared with Gmail and Photos (open question §20.3).

### 5.5 Per-device budgets (defaults, adjustable)

What a user is actually reading at any time is far smaller than the library. A field-exam list of 100–200 papers is ~0.5 GB of PDFs; a few books in progress add ~0.1–0.3 GB.

| Device | Core + core index | Content budget | Full-text index | Typical total |
|---|---|---|---|---|
| iPhone | all (~50–100 MB) | 1–2 GB | cached content only | ≤ 2.5 GB |
| Boox | all | 2–4 GB (main reading device) | cached content only | ≤ 4.5 GB |
| Mac | all | unlimited (keep everything) | whole library; builds `_index/` | 5–20 GB+ |

These budgets are a small fraction of the platform quotas (§3.2) on current devices; the binding constraints are courtesy to the user's storage, plus memory. The settings screen shows the actual space used per residency class and lets the user change the budget, pin or unpin collections, and clear content.

## 6. Search (tiered)

### 6.1 Tier 1 — core search (every device, always complete)

Covers metadata, keywords (with hierarchy expansion), entities, collection membership, notes, highlights and quotes, and estimate fields. Built from core files, so it is complete on every device.

### 6.2 Tier 2 — local full text

A full-text index of whatever extracted text is cached on this device. On the Mac this is the whole library by default; on mobile it covers only cached content.

### 6.3 Tier 3 — library-wide full text from a device that lacks local content

Two options, both behind capabilities:

- **Shared prebuilt index:** the indexer device (normally the Mac) builds `_index/fulltext.sqlite` (SQLite FTS5) and uploads it. Other devices query it with `rangeRead`, fetching only the database pages a query touches (the sql.js-httpvfs technique), or download it whole if space allows. It is derived, single-writer, and rebuildable.
- **`remoteSearch`:** Drive's server-side full-text search. Useful, but tied to one backend, coarse (it returns files, not passages), and it will stop working for encrypted files.

### 6.4 Coverage reporting

Every result list states its coverage, for example: *"Full text searched for 412 of 3,108 items on this device · prebuilt index from Nov 24 · 7 further matches via Drive."* Hits are grouped by item, show which version matched, and map to page numbers using the page offsets stored with the extracted text (§9.3).

### 6.5 Query syntax (draft)

`"minimum wage" type:article status:to-read in:labor-field-exam jel:J2 author:card affil:princeton year:1990..2000 has:estimate`

Restricted content is searchable on the device. Restrictions only filter what leaves it (§13).

## 7. Library layout

```
MayaLib/
  library.yaml                       # format version, library ID
  _schema/                           # taxonomies (§8)
  _templates/                        # note-template library (§11)
  _config/providers.yaml             # non-secret provider settings
  _index/                            # shared derived files (rebuildable)
    core-bundle.jsonl.gz
    fulltext.sqlite
  items/
    1994-card-minimum-wages--3q8x/
      item.md
      notes/01JDXA…-highlight.md
      history/<deviceId>.jsonl
      files/
        nber-w4509.pdf
        nber-w4509.pdf.text.txt      # extracted text for this file
        nber-w4509.pdf.text.json     # extraction metadata + page offsets
        aer-1994.pdf
        aer-1994.pdf.text.txt
        aer-1994.pdf.text.json
    2026-fed-blog-tariffs--9m1z/
      item.md
      files/
        2026-11-25T1403Z.html        # single-file snapshot (assets inlined)
        2026-11-25T1403Z.md          # readable extract (Readability → Markdown)
        2026-11-25T1403Z.md.text.json
  entities/
    people/card-david--4h7d.md
    orgs/princeton-university--2x9q.md
    venues/american-economic-review--8b1c.md
    events/nber-summer-institute-2026--5t2a.md
  collections/labor-field-exam--7k2p/collection.md
  ideas/01JDXC…-idea.md
  inbox/                             # drop folder (Boox exports, quick captures)
  exports/                           # generated .bib / .json (rebuildable)
```

`library.yaml`:

```yaml
formatVersion: 1
libraryId: 01JDX0…
created: 2026-11-25
indexer: mac-work-01                 # device that builds _index/
```

An app that finds a `formatVersion` newer than it understands opens the library read-only.

## 8. Identifiers and taxonomies

### 8.1 Identifiers

| Identifier | Example | Rules |
|---|---|---|
| Internal ID | `01JDX8Q3…` (ULID) | For items, notes, entities and collections. Assigned at creation and never changed. |
| Citation key | `card1994minimum` | Generated once and never regenerated automatically. Renaming adds the old key to `citekeyAliases`. |
| External IDs | DOI, ISBN, NBER, SSRN, arXiv, RePEc, ORCID, ROR, OpenAlex, Wikidata | Stored on versions and entities. Used for deduplication and lookup. |

### 8.2 Taxonomy file structure

```yaml
taxonomy: item-type
terms:
  - id: core:article
    label: Journal article
    parent: core:publication
    csl: article-journal
    suggestTemplates: [core:empirical-paper]
  - id: core:old-term
    deprecated: true
    replacedBy: core:article
```

Rules: an `id` never changes; `core:` terms ship with MayaLib and `my:` terms are the user's; `parent` creates a hierarchy, so queries also match descendants; terms are retired, never deleted; unknown terms are shown raw and kept.

### 8.3 Initial taxonomies

- **Item types:** publication (`article`, `working-paper`, `book`, `chapter`, `edited-volume`, `report`, `thesis`, `review`), `webpage` (`blog-post`, `news-article`, `policy-brief`), event (`talk`, `conference-session`, `lecture`), resource (`dataset`, `replication-package`, `software`, `media`), own work (`draft`, `slides`, `referee-report`, `discussion`)
- **Entity types (§10):** `person`, organization (`university`, `department`, `institute`, `central-bank`, `government-agency`, `publisher`), venue (`journal`, `working-paper-series`, `conference-series`), `event` (`conference`, `workshop`, `seminar`)
- **Contributor roles:** `author`, `editor`, `translator`, `speaker`, `discussant`, `organizer`, `chair`
- **Reading status:** `inbox`, `to-read`, `reading`, `read`, `skimmed`, `reference-only`, `abandoned`
- **Publication status (per version):** `draft`, `working-paper`, `submitted`, `revise-resubmit`, `forthcoming`, `published`, `retracted`, `live` (web), `withdrawn`
- **Collection kinds:** `reading-list`, `project`, `course`, `field-exam`, `seminar-series`, `reading-group`
- **Note kinds:** `summary`, `highlight`, `comment`, `question`, `estimate`, `idea`, `talk-notes`, `review-comment`
- **Restriction reasons:** `referee-confidential`, `embargo`, `shared-by-author`, `personal`, `license`
- **Link types:** §12
- **Vocabularies:** free tags plus controlled vocabularies (`jel:J23`, with hierarchy J → J2 → J23)

## 9. Items, versions and sources

### 9.1 Item file (`item.md`)

```yaml
---
id: 01JDX8Q3…
citekey: card1994minimum
citekeyAliases: []
type: core:article
title: "Minimum Wages and Employment: A Case Study of the Fast-Food Industry in New Jersey and Pennsylvania"
contributors:
  - {role: core:author, ref: 01JDP1…, asPrinted: {family: Card, given: David}}
  - {role: core:author, ref: 01JDP2…, asPrinted: {family: Krueger, given: Alan B.}}
keywords: [jel:J23, jel:J38, minimum-wage, diff-in-diff]
reading: {status: core:read, priority: high}
added: 2026-11-25
versions:
  - id: nber-w4509
    pubStatus: core:working-paper
    issued: 1993
    venue: 01JDV3…                  # entity: NBER Working Paper series
    ids: {nber: w4509}
    files: [files/nber-w4509.pdf]
  - id: aer-1994
    pubStatus: core:published
    issued: 1994-09
    venue: 01JDV1…                  # entity: American Economic Review
    ids: {doi: "10.xxxx/…"}
    csl: {volume: 84, issue: 4, page: "772-793"}
    files: [files/aer-1994.pdf]
citeVersion: aer-1994
links:
  - {type: core:challenged-by, target: 01JDX9…, note: "Neumark & Wascher payroll-data reanalysis"}
restriction: null
---
(free-form notes; may start from a template — §11)
```

- `asPrinted` keeps the name exactly as it appears on the work, which citations need. `ref` points to the entity (§10). A contributor may have `asPrinted` but no `ref` yet, until the name is matched to an entity.
- Citations merge top-level fields with the chosen version's fields. Venue names come from the venue entity.

### 9.2 Web pages

Each capture of a web page is a **version**. Capturing the page again adds a new version, so a page that changes keeps its history.

```yaml
versions:
  - id: snap-2026-11-25T1403Z
    pubStatus: core:live
    issued: 2026-11-20               # publication date shown on the page, if any
    capture:
      url: https://example.org/blog/tariffs
      finalUrl: https://example.org/blog/tariffs?utm=…
      capturedAt: 2026-11-25T14:03:12Z
      method: bookmarklet            # bookmarklet | extension | shortcut | share-target | service
      contentHash: sha256:…
      archiveUrl: null               # filled if an archive provider is used
    files:
      - files/2026-11-25T1403Z.html   # complete single-file snapshot
      - files/2026-11-25T1403Z.md     # readable extract; used for extraction and reading on e-ink
```

- **Why capture happens in the page:** a PWA can't fetch arbitrary web pages itself (browsers block cross-site requests). Capture therefore runs inside the page being viewed — a bookmarklet or extension, an iOS Shortcut, an Android share target — or goes through a capture service. In-page capture also preserves content the user can see but a server couldn't fetch, such as subscribed or paywalled pages.
- Citations use `URL` and `accessed` (= `capturedAt`) from the cited version.
- Restricted items are never sent to an `archive` provider.

### 9.3 Extracted text

Each source file gets its own extracted text, `<file>.text.txt`. Versions are never merged into a single text file. Alongside it, `<file>.text.json` records:

```json
{"extractor":"pdfjs@4.x","extractedAt":"2026-11-25T14:05:00Z","ocr":false,
 "pageOffsets":[0,2311,4870, …], "sourceHash":"sha256:…"}
```

- The page offsets map a search hit, or a highlight, back to a page number.
- Extracted text is stored in the library, so a file is extracted once for all devices. Each device downloads it only on demand.
- Search indexes every version but groups hits by item. A later feature could show differences between versions ("what changed between the working paper and the published version").

## 10. Entities

People, organizations, venues and events are first-class records, so the app can offer growing pick lists and graph views of the field.

```yaml
# entities/people/card-david--4h7d.md
---
id: 01JDP1…
kind: core:person
name: {family: Card, given: David}
variants: [{family: Card, given: D.}]
ids: {orcid: …, repec: …, openalex: …}
relations:
  - {type: core:works-at, target: 01JDO7…, from: 1983, to: 1997, role: Professor}   # Princeton
  - {type: core:works-at, target: 01JDO8…, from: 1997}                              # UC Berkeley
mergedInto: null
---
Free-form notes about the person.
```

- **Relations between entities** use the link mechanism (§12): `works-at`, `member-of`, `part-of` (department → university), `held-at` (event → organization), `instance-of` (conference 2026 → conference series), `advised-by`.
- **Derived, never stored:** co-authorship, which venues an author publishes in, and the citation graph among library items. These are computed by the index for graph views.
- **Resolving names to entities:** creating an item can propose matches against existing entities and the `entityLookup` providers. Names that aren't matched yet remain as `asPrinted` only.
- **Merging duplicates:** the losing record keeps `mergedInto: <id>`, so existing references still resolve. Records are never deleted.

## 11. Note templates

- Templates live in `_templates/` as Markdown files: headings, optional prompts written as comments, and optional structured fields. The user can create, edit, copy and retire them.
- Item types *suggest* templates (`suggestTemplates`). The user picks one, or none, when starting to read.
- Applying a template **copies** its sections into the notes. After that the notes are free text: sections can be deleted, renamed or added, and nothing is validated. The item records `template: core:empirical-paper@3` for reference only. Later edits to the template never change existing notes.

```markdown
---
id: core:empirical-paper
version: 3
label: Empirical paper
---
## Question
<!-- What is the causal or descriptive question? -->
## Setting & data
## Identification
## Main results
## Mechanisms & robustness
## Limitations
## My take
```

## 12. Notes, status, links

**Notes** (`notes/*.md`, `ideas/*.md`) are one file per entry. Each carries `kind`, `item` (if any), `created`, and `locator` (`{version, page, section, quote}`). Estimate notes hold structured records (`parameter`, `value`, `se`, `units`, `sample`, `method`, `locator`).

**Status:** the current reading status is stored in `item.md`. Every change is also appended to `history/<deviceId>.jsonl`, one log per device, so the logs never conflict.

**Links** are `{type, target, note?, locator?}`, stored once in the source object's file. The index works out the reverse direction. Links connect items, notes, entities and collections.

| Group | Types (with inverse) |
|---|---|
| Bibliographic | `comment-on`/`commented-on-by`, `reply-to`/`replied-by`, `replication-of`/`replicated-by`, `erratum-for`/`has-erratum`, `split-from`/`split-into`, `merged-into`/`merged-from`, `part-of`/`has-part` |
| Intellectual | `builds-on`, `extends`, `supports`, `challenges`, `uses-data-of`, `uses-method-of`, `same-setting-as` (symmetric) |
| Workflow | `presentation-of`, `review-of`, `discusses`, `inspired-by` |
| Entity | `works-at`/`employs`, `member-of`, `part-of`, `held-at`/`hosted`, `instance-of`, `advised-by`/`advised`, `presented-at` (item → event) |

Link types may declare `from`/`to` object types, and may carry `from`/`to` dates for time-bounded relations.

## 13. Restrictions (privacy)

```yaml
restriction:
  reason: core:referee-confidential
  audience: ["editor:JPE"]
  until: 2027-06-30
  then: review                      # lift | review | keep
  flows:
    export: exclude
    external: never                 # no provider with dataLeavesDevice=true (OCR, AI, archive, lookups)
    sync: plain                     # plain | encrypt (later) | local-only (later)
    display: normal                 # normal | hide-in-present (later)
```

- Restrictions apply to items, notes and collections. A note inherits its item's restriction unless it has its own.
- The capability registry checks `flows.external` before sending restricted data to any provider whose `dataLeavesDevice` is true.
- **v1 enforces** `export` and `external`. Encryption before upload and the display controls come later.
- When `until` passes, the app prompts according to `then`. It never lifts a restriction silently.

## 14. Collections

`collection.md` holds `kind`, `title`, an optional `due` date, and ordered `sections[].members[]` (`{item, required, note}`), followed by free-form notes. Membership lives in the collection's file. The index works out each item's collections (`in:…` queries). Project collections can export their own `.bib` file and hold ideas.

## 15. Citations and export

- CSL-JSON is the internal citation model; citeproc-js renders citation styles.
- BibTeX/BibLaTeX export uses each item's stable `citekey`. Each project can export its own `.bib` file.
- The library folder itself is the complete export. CSV, CSL-JSON and GraphML (for entity and link graphs) are available as conveniences.

## 16. Google Drive as the first storage provider

Drive supplies `storage`, `rangeRead` and `remoteSearch`, and keeps file revisions as a last-resort undo. Every one of these has a replacement (§4).

### 16.1 How access is granted

MayaLib never signs in as anyone. **The user signs into their own Google account and grants MayaLib limited access to their Drive.** MayaLib only ever holds a short-lived access pass (a token), never the user's password.

First launch on each device:

1. The user taps *Connect Google Drive*.
2. Google's own page opens. The user signs in (or is already signed in) and sees: "**MayaLib** wants to see and edit the files it creates in your Google Drive."
3. The user approves. Google gives MayaLib a token that lasts about an hour, covers only the approved permissions, and is renewed silently while the user stays signed into Google in that browser.
4. The user chooses or creates the library folder. The account hint and folder ID are stored on that device only.

**Why the browser's existing Google login isn't used directly:** if any website could use a visitor's Google login to read their Drive, every site could read everyone's Drive. So Google requires each app to identify itself, get the user's explicit approval for that particular app, and use a pass limited to what was approved. Like a valet key: the user chooses to hand it over, it opens only certain things, and it can be taken back.

**Revoking access:** the user revokes MayaLib's access in their Google account (Security → Third-party apps), which cuts off every device at once. Permission is therefore managed outside MayaLib, by the user's Google account. That is the nearest equivalent, on mobile, to the "access managed by the operating system" goal: on the Mac, Google Drive for desktop already holds access and exposes an ordinary folder to every app, but iOS and Android have no such shared folder, so each app must request its own pass.

### 16.2 App registration (the OAuth client)

Google identifies the requesting app by an **OAuth client ID**. A web address plus an app name is not enough: Google issues tokens only to registered clients. Registration gives Google an accountable owner, a way to suspend an abusive app, a place to apply usage limits, and a basis for its "unverified app" checks. (Some newer systems let an app identify itself by its URL alone, as Bluesky's AT Protocol does, but Google, Dropbox and Microsoft do not. Each future storage provider will need its own one-time registration, except self-hosted ones such as WebDAV/Nextcloud, which typically use an app-specific password instead.)

The registration lives in a Google Cloud project, owned by **any** Google account (a dedicated account is fine). It need not be the account whose Drive MayaLib uses. It is free, and the Drive API needs no billing account. It records:

- **Allowed web addresses** (JavaScript origins), e.g. `https://mayalib.org` and `http://localhost:5173`. Sign-in requests using this client ID from any other address are refused, which stops other sites from posing as MayaLib.
- **Consent screen details:** app name ("MayaLib"), optional logo, and a contact email. The user sees these when approving.
- **Permissions requested** (`drive.file`, or `drive` — see open question 9) and the publishing status (testing or published).
- **The Google Drive API being turned on** for the project.

The client ID identifies a **deployment**, not a user. It contains no name or email and is not a secret. On its own it grants access to nothing.

### 16.3 Deployment configuration

- The client ID is **never committed** to the repository. It is supplied at build time as an environment variable of the Cloudflare project (`GOOGLE_CLIENT_ID`), or from an uncommitted `config.local.json` for local development, and written into the deployed `config.json`.
- It is unavoidably visible in the deployed app and in sign-in requests. This is normal for browser OAuth clients and is harmless because of the allowed-address restriction.
- Anyone who runs their own copy of MayaLib registers their own Cloud project and client ID. No one should sign in through someone else's deployment, which would name that person as the app's developer.

### 16.4 Setup procedure (once per deployment, ~15 minutes)

1. In the Google Cloud console, create a project (e.g. `mayalib`) under the chosen Google account.
2. Turn on the **Google Drive API** (APIs & Services → Library).
3. Set up the **OAuth consent screen**: user type *External*; app name *MayaLib*; contact email; add the permission (`drive.file`); add your own account as a test user.
4. Create the **OAuth client** (Credentials → Create credentials → OAuth client ID → *Web application*). Add the allowed web addresses: the production host (`https://mayalib.org`, plus the `*.pages.dev` address if used) and the local development address (e.g. `http://localhost:5173`). No redirect URIs are needed for the browser token flow.
5. Set the client ID as the build environment variable `GOOGLE_CLIENT_ID` in the Cloudflare project (Settings → Variables), and in `config.local.json` for local development.
6. Decide the publishing status. Testing mode limits sign-in to listed test users and may make approvals expire after 7 days; publishing without verification shows a one-time "unverified app" warning for some permissions. **To confirm in the setup spike** for `drive.file` and `drive`.

### 16.5 Drive adapter mechanics

- **Paths ↔ IDs:** a cached path→ID map. Duplicate names in one folder are surfaced as conflicts.
- **Conditional writes:** emulated by checking the file's current version and then writing.
- **Changes:** `changes.list` with a start page token serves as the `changesSince` cursor.

## 17. Versioning and migrations

- `formatVersion` follows semantic-versioning rules. Adding fields or terms needs no bump; renaming or removing them, or changing their meaning, requires a major bump plus an explicit, logged, reversible migration.
- Taxonomy and template changes are always additive and never require a format bump.

## 18. Roadmap

**v1 — data model complete; features minimal**
- Early spike: benchmark pdf.js rendering and the SQLite/OPFS search index on the actual Boox and iPhone
- Capability registry; Drive and in-memory storage providers; conformance test suite
- Core mirror, content cache with pinning and a budget, outbox, conflict copies
- Items with versions; add by DOI, ISBN, NBER ID or URL; PDF/EPUB attach; web capture via bookmarklet
- Entities (people, organizations, venues, events) with pick lists and `asPrinted` matching
- Reading status and history; keywords and JEL; collections; links
- Template library and notes with locators
- Tier 1 and tier 2 search, plus `remoteSearch` via Drive, with coverage reporting
- BibTeX/CSL-JSON export; restrictions enforced for export and external services

**v2**
- Shared prebuilt full-text index plus range-read querying; bootstrap bundle
- Estimate records and table views; graph views of entities and links
- Boox annotation import; iOS Shortcut and Android share-target capture
- Optional wrapped build (Capacitor) for the Boox: native PDF rendering and share target
- `entityLookup` (OpenAlex/ORCID/ROR); local OCR

**Later**
- Encrypted sync; presentation mode; alerts; archive provider; AI helpers; version diffs; more storage providers

## 19. Decisions log

| # | Decision |
|---|---|
| D1 | Plain files are the source of truth; the first storage provider is Google Drive via its API |
| D2 | The client is an installable web app (PWA); the implementation substrate is otherwise open (§20) |
| D3 | Each item is one work containing its versions; links handle splits and mergers |
| D4 | Reading lists and projects are both "collections", with membership stored in the collection's file |
| D5 | Privacy is a restriction record with flows, enforced in stages |
| D6 | Web pages are versioned snapshots that record URL and capture time |
| D7 | Contributors, organizations, venues and events are entities; names as printed are kept alongside |
| D8 | Note templates are a user-managed library; applying one copies its sections and constrains nothing afterwards |
| D9 | Every external dependency is a capability with swappable providers |
| D10 | No paid Apple developer account. The iPhone version is a PWA, and every feature must work in the plain PWA on iOS |
| D11 | Native or wrapped shells are optional enhancements (Android and macOS only), implemented as alternative providers |
| D12 | Device-local data is a cache. Unsent changes are the only data at risk, so they are uploaded immediately and shown while pending |
| D13 | No account-related identifiers in the repository. The OAuth client ID is per-deployment configuration injected at build time |
| D14 | v1 search = each device's local index + Drive's `remoteSearch`, with coverage reporting. The shared prebuilt index and the indexer role are postponed to v2 (resolves §20.2, §20.4) |
| D15 | Name-to-entity matching suggests, never decides: v1 matches against entities already in the library; v2 adds OpenAlex suggestions. Never auto-merge (resolves §20.5) |
| D16 | Storage pressure: show usage per residency class; optional per-version `keepOriginal: false` keeps text, metadata and DOI/URL but drops the original file; paid Google storage as fallback (resolves §20.3) |
| D17 | Search engine: official SQLite WebAssembly build with FTS5, using the `opfs-sahpool` storage mode (works without special server headers); fallback MiniSearch if Spike 0 fails |
| D18 | Drive scope: `drive.file` for v1 (provisional; reversible without data changes), with a picker-based "import from inbox" step (§20.9) |
| D19 | Before real implementation, Spike 0 (a throwaway test app) verifies on the actual devices: OAuth behavior per scope and publishing status; iOS persistent storage; SQLite/OPFS on Safari and the Boox; pdf.js speed on the Boox; Shortcut → Drive capture; bookmarklet capture size |
| D20 | **Hosting: Cloudflare.** Register `mayalib.org` with Cloudflare Registrar and serve the app from Cloudflare (Pages, or Workers static assets) via its GitHub integration: every push to `main` builds and publishes. **Rationale:** (1) MayaLib gets its own origin from day one (`*.pages.dev`, then `mayalib.org`), whereas GitHub Pages without a custom domain shares `ericdomeshek.github.io` with every Pages site on the account, which could then read MayaLib's storage and tokens; (2) Cloudflare can send HTTP security headers (`_headers`), notably a full Content Security Policy for an app that holds Drive access, which GitHub Pages cannot; (3) the registrar sells at cost, with the same price at renewal; (4) registration, DNS and hosting in one place, plus preview builds per branch and unmetered bandwidth for static files. **Accepted costs:** one more vendor and account (its GitHub app is limited to this repository); a Cloudflare-registered domain must use Cloudflare DNS. **Exit path:** the app is plain static files and the host never sees library data, so moving to GitHub Pages or another host is a configuration change (devices reinstall and rebuild caches; update the OAuth allowed origins). **Expected cost:** ~$11/yr for the domain (at-cost `.org`); hosting $0 on the free plan (static requests unlimited; 500 builds/month). **Re-examined after choosing a custom domain:** once `mayalib.org` exists, GitHub Pages with that domain also gives MayaLib its own origin, so reason (1) no longer distinguishes the two hosts. The remaining case for Cloudflare hosting is header control. GitHub Pages cannot set response headers. A `<meta>` Content Security Policy covers most directives, but not `frame-ancestors` (clickjacking protection), violation reporting, HSTS or Permissions-Policy, and GitHub Pages applies a fixed cache policy to every file (minor for a PWA, whose service worker manages its own cache). Preview builds and a single dashboard are conveniences. The alternatives weighed: (a) GitHub Pages with a `<meta>` CSP and the domain's DNS at Cloudflare, which keeps code, builds and hosting in GitHub and gives no third-party app repository access, at the cost of mainly clickjacking protection; (b) GitHub Pages proxied through Cloudflare, with headers added by Cloudflare rules, which gives full headers without repository access but is the most fiddly to configure (TLS mode, GitHub certificate provisioning behind the proxy). Both are defensible. **Decision kept:** full header control with the simplest setup outweighs the extra vendor for an app that holds Drive access. |
| D21 | **UI: Preact + TypeScript + Vite.** Chosen for a small runtime (suits the e-ink Boox), React's widely understood component style (low stranding risk; large pool of examples and compatible libraries), and fluency of tooling and assistants. The UI stays a thin layer over framework-independent TypeScript modules (format, sync, storage, search, citations), so it remains replaceable. PWA tooling: `vite-plugin-pwa` (to confirm in Spike 0). |

## 20. Open questions

1. ~~**Implementation substrate:**~~ *Resolved: web codebase (§3.1–3.3); search engine D17; Preact + TypeScript + Vite D21.*
2. ~~**Shared index:**~~ *Resolved: D14 (postponed to v2).* is the range-read SQLite approach worth its complexity, compared with relying on `remoteSearch` plus local indexes? Prototype both before committing.
3. ~~**Storage quota:**~~ *Resolved: D16.* what to do when source files outgrow the free 15 GB (shared with Gmail and Photos)? Options: a paid tier, keeping very large scans outside the library, or keeping text only for some items.
4. ~~**Indexer device:**~~ *Resolved: D14 (not needed in v1).* what happens when the Mac is offline for long periods? Can another device take over, and how is that handed off?
5. ~~**Resolving names to entities:**~~ *Resolved: D15.* how much to automate (OpenAlex matching) versus confirm by hand.
6. **Web capture on iOS** (to verify in Spike 0, D19): confirm that a Shortcut can write to the Google Drive location in Files, and how large a page it and a bookmarklet can serialize.
7. **Persistent storage on iOS** (to verify in Spike 0, D19): confirm the effective quota and that persistent storage is honored for Home Screen apps on current iOS.
8. ~~**Static host and address:**~~ *Resolved: D20 (Cloudflare; `mayalib.org`). Keep the domain on auto-renew with registrar lock; if it is ever lost, remove it from the OAuth allowed origins and revoke MayaLib's access immediately.*
9. **Drive permission scope** (provisionally `drive.file`, D18; confirm in Spike 0): `drive.file` (the narrowest: only files MayaLib created or that the user picks; files arriving by other routes, such as the iOS Shortcut, Boox exports or the Mac's Drive folder, must be imported through the Google Picker) versus `drive` (full Drive access: those routes work directly, and the Mac could use the Drive for desktop folder; costs: broad access, plus a one-time "unverified app" warning). Leaning `drive.file` for v1 with a picker-based "import from inbox" step. To confirm in a setup spike: token and consent behavior for an unverified personal-use app.
