// pdf.js rendering speed (design §3.3: the main argument for a native shell on the Boox).
import { useRef, useState } from 'preact/hooks';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { errText, record } from '../results';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const P = 'pdf';

export function PdfPanel() {
  const holder = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const say = (s: string) => setLog((l) => [...l, s]);

  async function onFile(file: File) {
    setBusy(true);
    setLog([]);
    holder.current!.innerHTML = '';
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const t0 = performance.now();
      const doc = await pdfjs.getDocument({ data }).promise;
      const openMs = Math.round(performance.now() - t0);
      say(`Opened ${file.name} (${Math.round(file.size / 1024)} KB, ${doc.numPages} pages) in ${openMs} ms`);
      const width = Math.min(holder.current!.clientWidth || 700, 900);
      const pages: number[] = [];
      for (let p = 1; p <= Math.min(5, doc.numPages); p++) {
        const page = await doc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * Math.min(devicePixelRatio, 2) });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${width}px`;
        if (p <= 2) holder.current!.appendChild(canvas);
        const t = performance.now();
        await page.render({ canvas, viewport }).promise;
        const ms = Math.round(performance.now() - t);
        pages.push(ms);
        say(`Page ${p}: rendered in ${ms} ms`);
      }
      const t2 = performance.now();
      let chars = 0;
      for (let p = 1; p <= doc.numPages; p++) {
        const tc = await (await doc.getPage(p)).getTextContent();
        for (const it of tc.items) if ('str' in it) chars += it.str.length;
      }
      const extractMs = Math.round(performance.now() - t2);
      say(`Text extraction, all ${doc.numPages} pages: ${chars} characters in ${extractMs} ms`);
      record(P, file.name, { sizeKB: Math.round(file.size / 1024), pages: doc.numPages, openMs, renderMsFirstPages: pages, extractAllMs: extractMs, chars });
    } catch (e) {
      say(`✘ ${errText(e)}`);
      record(P, file.name, { error: errText(e) });
    }
    setBusy(false);
  }

  return (
    <section id="pdf">
      <h2>4. PDF rendering &amp; text extraction</h2>
      <p class="muted">
        Pick a typical paper PDF (and, separately, a large one, e.g. a scanned book chapter). Timings are recorded
        for the first five pages and for extracting the text of the whole file.
      </p>
      <input type="file" accept="application/pdf" disabled={busy}
        onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onFile(f); }} />
      <pre>{log.join('\n') || 'No PDF loaded.'}</pre>
      <div ref={holder} />
    </section>
  );
}
