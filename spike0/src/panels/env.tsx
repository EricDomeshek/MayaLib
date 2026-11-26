// Device & storage: what the platform grants, and whether stored data survives over days.
// Open questions: §20.7 (iOS persistence), §3.2 (quotas).
import { useEffect, useState } from 'preact/hooks';
import { kvGet, kvSet } from '../idb';
import { errText, record, type Json } from '../results';

const P = 'device';

interface Marker { firstSeen: string; lastSeen: string; visits: number }

function standalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function days(fromIso: string): number {
  return Math.round(((Date.now() - Date.parse(fromIso)) / 86_400_000) * 10) / 10;
}

// The same marker is kept in three places; comparing them shows which storage survives.
async function touchMarkers(): Promise<Record<string, Json>> {
  const now = new Date().toISOString();
  const bump = (m: Marker | undefined): Marker =>
    m ? { ...m, lastSeen: now, visits: m.visits + 1 } : { firstSeen: now, lastSeen: now, visits: 1 };
  const out: Record<string, Json> = {};

  try {
    const m = bump(await kvGet<Marker>('marker'));
    await kvSet('marker', m);
    out.indexedDB = { ...m, daysSinceFirst: days(m.firstSeen) };
  } catch (e) { out.indexedDB = errText(e); }

  try {
    const raw = localStorage.getItem('spike0.marker');
    const m = bump(raw ? (JSON.parse(raw) as Marker) : undefined);
    localStorage.setItem('spike0.marker', JSON.stringify(m));
    out.localStorage = { ...m, daysSinceFirst: days(m.firstSeen) };
  } catch (e) { out.localStorage = errText(e); }

  try {
    const dir = await navigator.storage.getDirectory();
    const fh = await dir.getFileHandle('marker.json', { create: true });
    const text = await (await fh.getFile()).text();
    const m = bump(text ? (JSON.parse(text) as Marker) : undefined);
    const w = await fh.createWritable();
    await w.write(JSON.stringify(m));
    await w.close();
    out.opfs = { ...m, daysSinceFirst: days(m.firstSeen) };
  } catch (e) { out.opfs = errText(e); }

  return out;
}

export function EnvPanel() {
  const [info, setInfo] = useState<Record<string, Json>>({});
  const [markers, setMarkers] = useState<Record<string, Json>>({});

  async function refresh() {
    const i: Record<string, Json> = {
      standalone: standalone(),
      serviceWorkerControlled: !!navigator.serviceWorker?.controller,
      opfsAvailable: typeof navigator.storage?.getDirectory === 'function',
      crossOriginIsolated: self.crossOriginIsolated ?? false,
      deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    };
    try {
      const est = await navigator.storage.estimate();
      i.quotaMB = Math.round((est.quota ?? 0) / 1e6);
      i.usageMB = Math.round(((est.usage ?? 0) / 1e6) * 10) / 10;
    } catch (e) { i.estimate = errText(e); }
    try { i.persisted = await navigator.storage.persisted(); } catch (e) { i.persisted = errText(e); }
    setInfo(i);
    record(P, 'info', i);
  }

  useEffect(() => {
    refresh();
    touchMarkers().then((m) => { setMarkers(m); record(P, 'markers', m); });
  }, []);

  async function requestPersist() {
    try {
      const granted = await navigator.storage.persist();
      record(P, 'persistRequestResult', granted);
    } catch (e) { record(P, 'persistRequestResult', errText(e)); }
    refresh();
  }

  return (
    <section id="env">
      <h2>1. Device &amp; storage</h2>
      <p class="muted">
        Install to the Home Screen first (iPhone: Safari → Share → Add to Home Screen; Boox: Chrome menu → Install app),
        then open it from there. Tap “Request persistent storage”. Re-open the app after a few days, and again after a week
        or more without using it: the markers show whether stored data survived.
      </p>
      <div class="row">
        <button onClick={requestPersist}>Request persistent storage</button>
        <button onClick={refresh}>Refresh</button>
      </div>
      <pre>{JSON.stringify(info, null, 2)}</pre>
      <h2>Survival markers</h2>
      <pre>{JSON.stringify(markers, null, 2)}</pre>
    </section>
  );
}
