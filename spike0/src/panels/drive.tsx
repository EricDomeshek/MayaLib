// Google sign-in and Drive operations. Open questions: §20.9 (scope; testing vs published),
// plus the Drive adapter mechanics in §16.5 (conditional writes, range reads, change feed, full-text search).
import { useEffect, useState } from 'preact/hooks';
import * as D from '../drive';
import { errText, record, timed, type Json } from '../results';

const P = 'drive';

export function DrivePanel() {
  const [scope, setScope] = useState<D.ScopeName>('drive.file');
  const [, setTick] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [idInput, setIdInput] = useState(localStorage.getItem('spike0.clientId') ?? '');
  const token = D.getToken();

  useEffect(() => D.onToken(() => setTick((t) => t + 1)), []);

  // Preload Google's script so the pop-up can open synchronously on tap (Safari's pop-up rule),
  // and pick up a token if we've just come back from the redirect flow.
  useEffect(() => {
    if (D.clientId()) D.loadGis().catch((e) => say(`✘ ${errText(e)}`));
    const r = D.completeRedirect();
    if (r) {
      record(P, 'token_redirect', { ok: r.ok, detail: r.detail, roundTripMs: r.elapsedMs ?? null });
      say(`${r.ok ? '✔' : '✘'} token_redirect (${r.elapsedMs ?? '?'} ms round trip): ${r.detail}`);
    }
  }, []);

  const say = (s: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${s}`]);

  async function step<T extends Json>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      const [v, ms] = await timed(fn);
      record(P, name, { ok: true, ms, value: v });
      say(`✔ ${name} (${ms} ms): ${JSON.stringify(v).slice(0, 200)}`);
      return v;
    } catch (e) {
      record(P, name, { ok: false, error: errText(e) });
      say(`✘ ${name}: ${errText(e)}`);
      return undefined;
    }
  }

  async function connect(prompt: '' | 'consent' | 'select_account') {
    setBusy(true);
    record(P, 'scopeRequested', scope);
    await step(`token_${prompt || 'silent'}`, async () => {
      const t = await D.requestToken(scope, prompt);
      return { grantedScope: t.scope, expiresInMin: Math.round((t.expiresAt - Date.now()) / 60000) };
    });
    setBusy(false);
  }

  async function runAll() {
    setBusy(true);
    const folder = await step('folder', D.findOrCreateFolder);
    if (folder) {
      localStorage.setItem('spike0.folderId', folder.id);
      const pageToken = await step('changesStartToken', D.startPageToken);
      const marker = `spike0marker${Date.now()}`;
      const text = `MayaLib Spike 0 test file.\n${marker}\n` + 'lorem ipsum '.repeat(2000);
      const created = await step('uploadSmall', async () => {
        const f = await D.uploadFile(folder.id, `test-${Date.now()}.txt`, new Blob([text]), 'text/plain');
        localStorage.setItem('spike0.testFileId', f.id);
        return f as unknown as Json;
      }) as unknown as D.DriveFile | undefined;
      if (created) {
        await step('readBack', async () => (await D.readText(created.id)) === text);
        await step('rangeRead', () => D.readRange(created.id, 0, 99) as unknown as Promise<Json>);
        // Conditional write emulation (design §16.5): check the version, then write.
        await step('conditionalUpdate', async () => {
          const before = await D.getMeta(created.id);
          const after = await D.updateContent(created.id, new Blob([text + '\nupdated']), 'text/plain');
          return { versionBefore: before.version ?? null, versionAfter: after.version ?? null,
            headRevisionBefore: before.headRevisionId ?? null, headRevisionAfter: after.headRevisionId ?? null };
        });
      }
      await step('uploadOneMB', async () => {
        const f = await D.uploadFile(folder.id, `blob-1mb-${Date.now()}.bin`, new Blob([new Uint8Array(1_000_000)]), 'application/octet-stream');
        return f.size ?? null;
      });
      if (pageToken) await step('changesSince', () => D.changesSince(pageToken) as unknown as Promise<Json>);
      await step('listFolder', async () => (await D.listFolder(folder.id)).map((f) => f.name));
      await step('fullTextSearch', async () => ({
        marker,
        hits: (await D.fullTextSearch(folder.id, marker)).length,
        note: 'Drive may take minutes to index new files; re-run “Search again” later.',
      }));
      localStorage.setItem('spike0.lastMarker', marker);
    }
    setBusy(false);
  }

  async function listOnly() {
    const id = localStorage.getItem('spike0.folderId');
    if (!id) { say('Run the Drive tests first to create the folder.'); return; }
    await step('listFolderAgain', async () => (await D.listFolder(id)).map((f) => f.name));
  }

  async function searchAgain() {
    const id = localStorage.getItem('spike0.folderId');
    const m = localStorage.getItem('spike0.lastMarker');
    if (!id || !m) { say('Run the Drive tests first.'); return; }
    await step('fullTextSearchLater', async () => ({ marker: m, hits: (await D.fullTextSearch(id, m)).length }));
  }

  function saveClientId() {
    if (idInput.trim()) localStorage.setItem('spike0.clientId', idInput.trim());
    else localStorage.removeItem('spike0.clientId');
    say(`Client ID ${idInput.trim() ? 'saved on this device' : 'cleared; using build-time value'}.`);
  }

  const configured = !!D.clientId();

  return (
    <section id="drive">
      <h2>2. Google sign-in &amp; Drive</h2>
      <p class="muted">
        Tests sign-in, then creates a folder “{D.FOLDER_NAME}” in your Drive and reads/writes test files in it.
        Try both scopes (revoke between them). “Connect (consent)” uses a pop-up; “Connect (redirect)” sends this
        whole window to Google and back, for Home Screen apps where pop-ups fail. To test whether files added outside MayaLib are visible: put any file
        into that folder using the Drive app or the iOS Files app, then tap “List folder again”.
      </p>
      {!configured && (
        <div>
          <p class="bad">No OAuth client ID is configured for this build.</p>
        </div>
      )}
      <details>
        <summary>OAuth client ID (stored on this device only)</summary>
        <input type="text" value={idInput} placeholder="xxxxxxxx.apps.googleusercontent.com"
          onInput={(e) => setIdInput((e.target as HTMLInputElement).value)} />
        <button onClick={saveClientId}>Save</button>
      </details>
      <div class="row">
        <label>Scope:&nbsp;
          <select value={scope} onChange={(e) => setScope((e.target as HTMLSelectElement).value as D.ScopeName)}>
            <option value="drive.file">drive.file (narrow)</option>
            <option value="drive">drive (full)</option>
          </select>
        </label>
      </div>
      <div class="row">
        <button disabled={busy || !configured} onClick={() => connect('consent')}>Connect (consent)</button>
        <button disabled={busy || !configured} onClick={() => connect('')}>Renew silently</button>
        <button disabled={busy || !configured} onClick={() => { record(P, 'scopeRequested', scope); D.startRedirect(scope, 'consent'); }}>Connect (redirect)</button>
        <button disabled={busy || !configured} onClick={() => { record(P, 'scopeRequested', scope); D.startRedirect(scope, 'none'); }}>Renew (redirect)</button>
        <button disabled={busy || !token} onClick={runAll}>Run Drive tests</button>
        <button disabled={busy || !token} onClick={listOnly}>List folder again</button>
        <button disabled={busy || !token} onClick={searchAgain}>Search again</button>
        <button disabled={busy || !token} onClick={() => step('revoke', async () => { await D.revoke(); return 'revoked'; })}>Revoke</button>
      </div>
      <p>
        Status: {token
          ? <span class="ok">connected — {token.scope.split(' ').map((s) => s.replace('https://www.googleapis.com/auth/', '')).join(', ')}; expires in {Math.round((token.expiresAt - Date.now()) / 60000)} min</span>
          : <span>not connected</span>}
      </p>
      <pre>{log.join('\n') || 'No Drive activity yet.'}</pre>
    </section>
  );
}
