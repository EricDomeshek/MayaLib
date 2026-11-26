// Web-page capture without a native app (design §3.1, §9.2; open question §20.6).
// The bookmarklet runs inside the page being read, serializes it, opens MayaLib at /#capture,
// and hands the snapshot over with postMessage.
import { useEffect, useState } from 'preact/hooks';
import { captureAll, captureClear, capturePut } from '../idb';
import * as D from '../drive';
import { errText, record } from '../results';

const P = 'capture';

interface Capture {
  id: string; url: string; title: string; capturedAt: string; receivedAt: string;
  htmlBytes: number; textChars: number; transferMs: number; html: string; text: string;
}

export function bookmarkletSource(origin: string): string {
  // Kept small and dependency-free: it runs on arbitrary third-party pages.
  const code = `(()=>{const O=${JSON.stringify(origin)};const t0=Date.now();` +
    `const d={type:'mayalib-capture',v:1,url:location.href,title:document.title,capturedAt:new Date().toISOString(),` +
    `html:'<!doctype html>'+document.documentElement.outerHTML,text:document.body?document.body.innerText:'',sentAt:t0};` +
    `const w=window.open(O+'/#capture','mayalib-capture');if(!w){alert('MayaLib: pop-up blocked');return;}` +
    `let n=0;const i=setInterval(()=>{try{w.postMessage(d,O)}catch(e){}if(++n>60)clearInterval(i)},250);` +
    `addEventListener('message',e=>{if(e.origin===O&&e.data==='mayalib-ack'){clearInterval(i)}})})()`;
  return 'javascript:' + encodeURIComponent(code);
}

/** Rendered at /#capture: receives the snapshot from the bookmarklet and stores it. */
export function CapturePage() {
  const [status, setStatus] = useState('Waiting for the page snapshot…');
  useEffect(() => {
    let done = false;
    const onMsg = async (e: MessageEvent) => {
      const d = e.data;
      if (done || !d || d.type !== 'mayalib-capture' || typeof d.html !== 'string' || typeof d.url !== 'string') return;
      done = true;
      // Acknowledge so the bookmarklet stops re-sending.
      (e.source as Window | null)?.postMessage('mayalib-ack', { targetOrigin: e.origin });
      const c: Capture = {
        id: `${Date.now()}`, url: d.url, title: String(d.title ?? ''), capturedAt: String(d.capturedAt ?? ''),
        receivedAt: new Date().toISOString(), htmlBytes: new Blob([d.html]).size, textChars: String(d.text ?? '').length,
        transferMs: typeof d.sentAt === 'number' ? Date.now() - d.sentAt : -1, html: d.html, text: String(d.text ?? ''),
      };
      try {
        await capturePut(c);
        setStatus(`Saved “${c.title}” — ${Math.round(c.htmlBytes / 1024)} KB of HTML, ${c.textChars} characters of text, ` +
          `delivered in ${c.transferMs} ms. You can close this tab and return to the page.`);
      } catch (err) {
        setStatus(`Received but could not store: ${errText(err)}`);
      }
    };
    addEventListener('message', onMsg);
    const timeout = setTimeout(() => { if (!done) setStatus('Nothing received after 20 seconds. Was this opened from the bookmarklet?'); }, 20000);
    return () => { removeEventListener('message', onMsg); clearTimeout(timeout); };
  }, []);
  return (
    <main>
      <h1>MayaLib — capture</h1>
      <p>{status}</p>
      <p><a href="/">Open the Spike 0 dashboard</a></p>
    </main>
  );
}

export function CapturePanel() {
  const [items, setItems] = useState<Capture[]>([]);
  const [msg, setMsg] = useState('');
  const src = bookmarkletSource(location.origin);

  async function refresh() {
    const all = await captureAll<Capture>();
    setItems(all);
    record(P, 'captures', all.map((c) => ({ url: c.url, htmlKB: Math.round(c.htmlBytes / 1024), textChars: c.textChars, transferMs: c.transferMs })));
  }
  useEffect(() => { refresh(); }, []);

  async function upload(c: Capture) {
    const folderId = localStorage.getItem('spike0.folderId');
    if (!D.getToken() || !folderId) { setMsg('Connect and run the Drive tests first (section 2).'); return; }
    try {
      const stamp = c.capturedAt.replace(/[:.]/g, '').slice(0, 15) + 'Z';
      const t0 = performance.now();
      await D.uploadFile(folderId, `capture-${stamp}.html`, new Blob([c.html]), 'text/html');
      await D.uploadFile(folderId, `capture-${stamp}.txt`, new Blob([`${c.title}\n${c.url}\n${c.capturedAt}\n\n${c.text}`]), 'text/plain');
      const ms = Math.round(performance.now() - t0);
      record(P, `upload_${c.id}`, { ok: true, ms });
      setMsg(`Uploaded to Drive in ${ms} ms.`);
    } catch (e) {
      record(P, `upload_${c.id}`, { ok: false, error: errText(e) });
      setMsg(errText(e));
    }
  }

  return (
    <section id="capturetest">
      <h2>5. Web-page capture</h2>
      <p class="muted">
        <b>Install the bookmarklet:</b> on the Mac, drag the link below to the bookmarks bar. On iPhone or Boox:
        bookmark any page, then edit that bookmark and replace its address with the copied code. Then open any article
        (try a news site and a journal page you subscribe to) and tap the bookmark. Come back here and tap Refresh.
      </p>
      <p class="muted">
        <b>iOS Shortcut test:</b> separately, try saving a page into the “{D.FOLDER_NAME}” Drive folder from a Shortcut
        (Share sheet → your Shortcut → Save File to the Google Drive location), then use “List folder again” in section 2.
      </p>
      <div class="row">
        <a href={src}>MayaLib capture (drag me)</a>
        <button onClick={() => navigator.clipboard.writeText(decodeURIComponent(src)).then(() => setMsg('Bookmarklet code copied.'), (e) => setMsg(errText(e)))}>
          Copy bookmarklet code
        </button>
        <button onClick={refresh}>Refresh</button>
        <button onClick={() => captureClear().then(refresh)}>Clear</button>
      </div>
      {msg && <p>{msg}</p>}
      {items.length === 0 ? <p>No captures yet.</p> : (
        <ul>
          {items.map((c) => (
            <li key={c.id}>
              <b>{c.title || '(untitled)'}</b> — {Math.round(c.htmlBytes / 1024)} KB HTML, {c.textChars} chars text,
              {' '}{c.transferMs} ms <span class="muted">{c.url}</span>
              <button onClick={() => upload(c)}>Upload to Drive</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
