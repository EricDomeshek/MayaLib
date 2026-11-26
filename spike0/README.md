# Spike 0 — feasibility tests on real devices

A **throwaway** Preact app that checks, on your actual Mac, iPhone and Boox, the things the design can't settle on paper (design doc D19 and open questions §20.6, §20.7, §20.9). Nothing here is production code: once the answers are in, it gets deleted or frozen. Because it's throwaway, it has no unit tests; the real app will (see `CLAUDE.md`).

## What it tests

| Section | Question it answers | Design ref |
|---|---|---|
| 1. Device & storage | Quota; whether persistent storage is granted; whether IndexedDB, localStorage and OPFS data **survive days of non-use** (esp. iOS Home Screen app) | §3.2, §20.7 |
| 2. Google sign-in & Drive | Sign-in with `drive.file` vs `drive`; silent renewal; testing vs published mode; folder/file create, read-back, **range reads**, conditional update, **change feed**, Drive full-text search; whether files added **outside** MayaLib are visible | §16, §20.9 |
| 3. SQLite full-text search | Official SQLite WASM + FTS5 in OPFS (`opfs-sahpool`): loads? persists across restarts? insert and search speed | D17 |
| 4. PDF | pdf.js open/render/extract speed, especially on the Boox | §3.3 |
| 5. Web-page capture | Bookmarklet capture (incl. pages behind your subscriptions) and the iOS Shortcut → Drive route | §9.2, §20.6 |
| 6. Report | Collects everything as JSON to copy/download and send back | — |

## Run it locally (Mac)

Requires Node 22+.

```sh
cd spike0
npm install
# optional, never committed: your OAuth client ID (design §16.4)
echo '{ "googleClientId": "YOUR_ID.apps.googleusercontent.com" }' > config.local.json
npm run dev          # → http://localhost:5173
```

The client ID can also be pasted into section 2 at runtime (stored on that device only). Local dev does **not** apply the `_headers` security headers; the deployed site does.

## Deploy on Cloudflare (for iPhone and Boox)

Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → choose `EricDomeshek/MayaLib` only, then:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | `spike0` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables | `GOOGLE_CLIENT_ID` = your client ID; `NODE_VERSION` = `22` |

Then **Custom domains → add `mayalib.org`**. In the Google Cloud OAuth client, the allowed JavaScript origins must include `https://mayalib.org` (and `http://localhost:5173` for local runs).

## Test protocol

Do this on **each device** (Mac browser, iPhone Home Screen app, Boox installed app), then send the report from section 6.

1. **Install** (iPhone: Safari → Share → *Add to Home Screen*; Boox: Chrome menu → *Install app*) and open from the icon. Section 1 should show `"standalone": true`.
2. **Section 1:** tap *Request persistent storage*.
3. **Section 2 (narrow scope):** *Connect (consent)* → *Run Drive tests*. Then add any file to the `MayaLib-Spike0` folder using the Google Drive app (or iOS Files), and tap *List folder again*: is it listed? A few minutes later, tap *Search again*.
4. **Section 2 (full scope):** *Revoke*, switch the scope to `drive (full)`, and repeat step 3. Note any warning screens.
5. **Section 3:** *Start* → *Add docs* (2,000) → *Search*. Fully close the app, reopen, *Start* again: `existingRows` should be unchanged. On the Mac, also try 10,000.
6. **Section 4:** open a typical paper PDF, then a large scanned one.
7. **Section 5:** install the bookmarklet, capture two or three pages (one behind a subscription), *Refresh*, and *Upload to Drive* one of them. On iPhone, also try a Shortcut that saves into the Drive folder.
8. **Section 6:** add a note naming the device, then copy or download the report.
9. **Later checks:** reopen the app after ~3 days and again after **8+ days of non-use**. Check the survival markers in section 1 and whether *Renew silently* in section 2 still works without a consent screen (Google's testing mode may expire approvals after 7 days).

## Notes

- `public/_headers` sets a strict Content Security Policy plus HSTS and related headers. Any CSP violation will show in the browser console; please report it.
- No Cross-Origin-Opener-Policy is set: it would break both the bookmarklet hand-off and Google's sign-in popup.
- The capture page accepts a snapshot from any site that opens it (it only stores it locally and never renders the HTML). The real app should ask for confirmation before filing a capture.
