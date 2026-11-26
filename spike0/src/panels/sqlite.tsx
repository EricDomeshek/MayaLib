// SQLite + FTS5 in OPFS (opfs-sahpool). Checks D17: does it load, persist across restarts,
// and search fast enough on the Boox and iPhone?
import { useEffect, useRef, useState } from 'preact/hooks';
import { record, type Json } from '../results';

const P = 'sqlite';

export function SqlitePanel() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (r: { ok: boolean; result?: Json; error?: string }) => void>());
  const nextId = useRef(1);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [n, setN] = useState(2000);
  const [q, setQ] = useState('minimum AND elasticity');

  const say = (s: string) => setLog((l) => [...l, s]);

  function send(msg: Record<string, unknown>): Promise<{ ok: boolean; result?: Json; error?: string }> {
    const id = nextId.current++;
    return new Promise((resolve) => {
      pending.current.set(id, resolve);
      worker.current!.postMessage({ ...msg, id });
    });
  }

  async function run(name: string, msg: Record<string, unknown>) {
    setBusy(true);
    const r = await send(msg);
    record(P, name, r.ok ? r.result! : { error: r.error ?? 'unknown' });
    say(`${r.ok ? '✔' : '✘'} ${name}: ${JSON.stringify(r.ok ? r.result : r.error)}`);
    setBusy(false);
    return r;
  }

  async function start() {
    try {
      worker.current = new Worker(new URL('../sqlite.worker.ts', import.meta.url), { type: 'module' });
      worker.current.onmessage = (e) => {
        const cb = pending.current.get(e.data.id);
        pending.current.delete(e.data.id);
        cb?.(e.data);
      };
      worker.current.onerror = (e) => say(`✘ worker error: ${e.message}`);
      const r = await run('init', { cmd: 'init' });
      setReady(r.ok);
    } catch (e) {
      say(`✘ could not start worker: ${String(e)}`);
    }
  }

  useEffect(() => () => worker.current?.terminate(), []);

  return (
    <section id="sqlite">
      <h2>3. SQLite full-text search (in browser storage)</h2>
      <p class="muted">
        Start, add documents (each ~600 words, roughly a long abstract), and run searches. Then fully close and
        reopen the app and tap Start again: “existingRows” should still show the documents.
        Try 2,000 first, then 10,000 on the Mac.
      </p>
      <div class="row">
        <button disabled={busy || ready} onClick={start}>Start</button>
        <label>Docs:&nbsp;<input type="number" value={n} min={100} step={100}
          onInput={(e) => setN(Number((e.target as HTMLInputElement).value))} style="width:8em" /></label>
        <button disabled={busy || !ready} onClick={() => run(`populate_${n}`, { cmd: 'populate', n, words: 600 })}>Add docs</button>
      </div>
      <div class="row">
        <input type="text" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} style="max-width:22em" />
        <button disabled={busy || !ready} onClick={() => run(`query`, { cmd: 'query', q })}>Search</button>
        <button disabled={busy || !ready} onClick={() => run('stats', { cmd: 'stats' })}>Stats</button>
        <button disabled={busy || !ready} onClick={() => run('reset', { cmd: 'reset' })}>Wipe</button>
      </div>
      <pre>{log.join('\n') || 'Not started.'}</pre>
    </section>
  );
}
