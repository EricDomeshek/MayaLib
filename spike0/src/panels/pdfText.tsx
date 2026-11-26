// 4b. Selectable text + highlights on PDFs.
// Tests what annotation needs: text-layer cost (esp. on the Boox), whether touch selection is usable,
// and whether a highlight saved as {page, quote, prefix, suffix} (design §8 locators) can be found
// again and redrawn when the document is reopened.
import { useEffect, useRef, useState } from 'preact/hooks';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { kvGet, kvSet } from '../idb';
import { errText, record } from '../results';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const P = 'pdfText';
const CONTEXT = 32;

interface Highlight {
  id: string; page: number; quote: string; prefix: string; suffix: string;
  method: 'native' | 'tap'; createdAt: string;
}

interface PageState {
  textDivs: HTMLElement[];
  starts: number[];   // offset of each div's text within pageText
  pageText: string;
  page: number;
}

// Map a DOM position inside the text layer to an offset in pageText.
function toOffset(ps: PageState, node: Node, offset: number): number | null {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  const i = ps.textDivs.findIndex((d) => d === el || d.contains(el));
  if (i < 0) return null;
  return ps.starts[i] + (node.nodeType === Node.TEXT_NODE ? offset : 0);
}

// Map an offset in pageText back to a DOM position.
function toDom(ps: PageState, off: number): [Node, number] | null {
  for (let i = ps.textDivs.length - 1; i >= 0; i--) {
    if (ps.starts[i] <= off) {
      const t = ps.textDivs[i].firstChild;
      if (!t) return null;
      return [t, Math.min(off - ps.starts[i], t.textContent?.length ?? 0)];
    }
  }
  return null;
}

// Find the quote again, using prefix/suffix to choose between repeated occurrences.
function locate(ps: PageState, h: Highlight): [number, number] | null {
  let best: [number, number] | null = null;
  let bestScore = -1;
  for (let at = ps.pageText.indexOf(h.quote); at >= 0; at = ps.pageText.indexOf(h.quote, at + 1)) {
    const pre = ps.pageText.slice(Math.max(0, at - CONTEXT), at);
    const suf = ps.pageText.slice(at + h.quote.length, at + h.quote.length + CONTEXT);
    const score = (pre === h.prefix ? 2 : pre.endsWith(h.prefix.slice(-8)) ? 1 : 0) +
                  (suf === h.suffix ? 2 : suf.startsWith(h.suffix.slice(0, 8)) ? 1 : 0);
    if (score > bestScore) { best = [at, at + h.quote.length]; bestScore = score; }
  }
  return best;
}

// Find the character under a tap. document.caretPositionFromPoint is unreliable on pdf.js's
// scaled, absolutely positioned text spans (it can pick the line above), so hit-test the span by
// its bounding box and then find the character by measuring per-character rectangles.
function charAt(ps: PageState, x: number, y: number): [Node, number] | null {
  const span = ps.textDivs.find((d) => {
    const r = d.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  const t = span?.firstChild;
  if (!t || !t.textContent) return null;
  const r = document.createRange();
  for (let i = 0; i < t.textContent.length; i++) {
    r.setStart(t, i);
    r.setEnd(t, i + 1);
    const b = r.getBoundingClientRect();
    if (x >= b.left && x <= b.right) return [t, i];
  }
  return [t, x < span!.getBoundingClientRect().left + 1 ? 0 : t.textContent.length - 1];
}

export function PdfTextPanel() {
  const wrap = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const doc = useRef<PDFDocumentProxy | null>(null);
  const docKey = useRef('');
  const ps = useRef<PageState | null>(null);
  const tapStart = useRef<number | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [highlights, setHighlightsState] = useState<Highlight[]>([]);
  const hlRef = useRef<Highlight[]>([]);
  const setHighlights = (h: Highlight[]) => { hlRef.current = h; setHighlightsState(h); };
  const [tapMode, setTapMode] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const say = (s: string) => setLog((l) => [...l.slice(-30), s]);

  async function open(file: File) {
    setBusy(true);
    try {
      doc.current = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      docKey.current = `hl:${doc.current.fingerprints[0]}`;
      setNumPages(doc.current.numPages);
      setHighlights((await kvGet<Highlight[]>(docKey.current)) ?? []);
      say(`Opened ${file.name}: ${doc.current.numPages} pages.`);
      await renderPage(1);
    } catch (e) { say(`✘ ${errText(e)}`); }
    setBusy(false);
  }

  async function renderPage(n: number) {
    if (!doc.current || !wrap.current) return;
    setBusy(true);
    setPageNo(n);
    tapStart.current = null;
    ps.current = null;
    const host = wrap.current;
    host.innerHTML = '';
    if (overlay.current) overlay.current.innerHTML = '';
    const page = await doc.current.getPage(n);
    const cssWidth = Math.min(host.parentElement!.clientWidth || 700, 900);
    const base = page.getViewport({ scale: 1 });
    const scale = cssWidth / base.width;
    const viewport = page.getViewport({ scale });
    const dpr = Math.min(devicePixelRatio, 2);

    host.style.width = `${viewport.width}px`;
    host.style.height = `${viewport.height}px`;
    host.style.setProperty('--scale-factor', String(scale));
    host.style.setProperty('--user-unit', '1');

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    host.appendChild(canvas);
    const t0 = performance.now();
    await page.render({ canvas, viewport: page.getViewport({ scale: scale * dpr }) }).promise;
    const canvasMs = Math.round(performance.now() - t0);

    const layerDiv = document.createElement('div');
    layerDiv.className = 'textLayer';
    host.appendChild(layerDiv);
    const t1 = performance.now();
    const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layerDiv, viewport });
    await tl.render();
    const textMs = Math.round(performance.now() - t1);

    // Join text runs with a virtual space where neither side has whitespace, so words on
    // adjacent runs/lines don't fuse ("restaurants.Paragraph"). The space exists only in pageText.
    const strs = tl.textContentItemsStr;
    const starts: number[] = [];
    let pageText = '';
    for (const str of strs) {
      if (pageText && str && !/\s$/.test(pageText) && !/^\s/.test(str)) pageText += ' ';
      starts.push(pageText.length);
      pageText += str;
    }
    const acc = pageText.length;
    ps.current = { textDivs: tl.textDivs, starts, pageText, page: n };

    say(`Page ${n}: canvas ${canvasMs} ms, text layer ${textMs} ms (${tl.textDivs.length} text runs, ${acc} chars).`);
    record(P, `page${n}`, { canvasMs, textLayerMs: textMs, textRuns: tl.textDivs.length, chars: acc });
    setBusy(false);
    drawHighlights();
  }

  function drawHighlights(list = hlRef.current) {
    const ov = overlay.current, host = wrap.current, st = ps.current;
    if (!ov || !host || !st) return;
    ov.innerHTML = '';
    const box = host.getBoundingClientRect();
    let found = 0, missing = 0;
    for (const h of list.filter((x) => x.page === st.page)) {
      const loc = locate(st, h);
      const a = loc && toDom(st, loc[0]);
      const b = loc && toDom(st, loc[1]);
      if (!a || !b) { missing++; continue; }
      found++;
      const r = document.createRange();
      r.setStart(a[0], a[1]);
      r.setEnd(b[0], b[1]);
      for (const rect of r.getClientRects()) {
        const m = document.createElement('div');
        m.className = 'hl';
        Object.assign(m.style, {
          left: `${rect.left - box.left}px`, top: `${rect.top - box.top}px`,
          width: `${rect.width}px`, height: `${rect.height}px`,
        });
        ov.appendChild(m);
      }
    }
    if (found || missing) {
      say(`Redrew ${found} highlight(s) on page ${st.page}${missing ? `; ${missing} could not be re-anchored` : ''}.`);
      record(P, `reanchor_page${st.page}`, { found, missing });
    }
  }

  // Re-draw when the page or the highlight list changes.
  useEffect(() => { drawHighlights(); }, [highlights, pageNo]);

  async function saveFromSelection(method: 'native' | 'tap') {
    const st = ps.current;
    const sel = getSelection();
    if (!st || !sel || sel.rangeCount === 0 || sel.isCollapsed) { say('Select some text on the page first.'); return; }
    const r = sel.getRangeAt(0);
    let s = toOffset(st, r.startContainer, r.startOffset);
    let e = toOffset(st, r.endContainer, r.endOffset);
    if (s === null || e === null) { say('Selection is outside the page text.'); return; }
    if (e < s) [s, e] = [e, s];
    const quote = st.pageText.slice(s, e);
    if (!quote.trim()) { say('Empty selection.'); return; }
    const h: Highlight = {
      id: `${Date.now()}`, page: pageNo, quote,
      prefix: st.pageText.slice(Math.max(0, s - CONTEXT), s),
      suffix: st.pageText.slice(e, e + CONTEXT),
      method, createdAt: new Date().toISOString(),
    };
    const next = [...hlRef.current, h];
    await kvSet(docKey.current, next);
    setHighlights(next);
    sel.removeAllRanges();
    say(`Saved highlight (${method}): “${quote.slice(0, 80)}${quote.length > 80 ? '…' : ''}”`);
    record(P, `saved_${h.id}`, { page: h.page, chars: quote.length, method });
  }

  // Tap mode: tap the first word, then the last word; MayaLib builds the selection.
  function onTap(ev: MouseEvent) {
    if (!tapMode || !ps.current) return;
    const c = charAt(ps.current, ev.clientX, ev.clientY);
    const off = c && toOffset(ps.current, c[0], c[1]);
    if (off === null || off === undefined) return;
    const text = ps.current.pageText;
    if (tapStart.current === null) {
      let s = off;
      while (s > 0 && /\S/.test(text[s - 1])) s--;
      tapStart.current = s;
      say('Start set. Now tap the last word.');
      return;
    }
    let s = tapStart.current, e = off;
    if (e < s) [s, e] = [e, s];
    while (e < text.length && /\S/.test(text[e])) e++;
    tapStart.current = null;
    const a = toDom(ps.current, s), b = toDom(ps.current, e);
    if (!a || !b) return;
    const r = document.createRange();
    r.setStart(a[0], a[1]);
    r.setEnd(b[0], b[1]);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    saveFromSelection('tap');
  }

  async function clearAll() {
    await kvSet(docKey.current, []);
    setHighlights([]);
  }

  const onPage = highlights.filter((h) => h.page === pageNo);

  return (
    <section id="pdftext">
      <h2>4b. Selectable text &amp; highlights</h2>
      <p class="muted">
        Open a text-based paper PDF. Select a passage (finger or mouse) and tap “Save highlight”. If selecting with a
        finger is awkward, turn on Tap mode: tap the first word, then the last word. Reopen the same PDF later (or
        after restarting the app): saved highlights should be redrawn in the right places.
      </p>
      <input type="file" accept="application/pdf" disabled={busy}
        onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) open(f); }} />
      {numPages > 0 && (
        <div class="row">
          <button disabled={busy || pageNo <= 1} onClick={() => renderPage(pageNo - 1)}>‹ Prev</button>
          <span>Page {pageNo} / {numPages}</span>
          <button disabled={busy || pageNo >= numPages} onClick={() => renderPage(pageNo + 1)}>Next ›</button>
          <button disabled={busy} onClick={() => saveFromSelection('native')}>Save highlight</button>
          <button disabled={busy} onClick={() => { setTapMode(!tapMode); tapStart.current = null; }}>
            Tap mode: {tapMode ? 'ON' : 'off'}
          </button>
          <button disabled={busy || highlights.length === 0} onClick={clearAll}>Clear highlights</button>
        </div>
      )}
      {/* Fixed height: a growing log would shift the page between the two taps of Tap mode. */}
      <pre style="height:9em">{log.join('\n') || 'No PDF loaded.'}</pre>
      <div class="pdfPage" onClick={onTap}>
        <div ref={wrap} class="pdfLayers" />
        <div ref={overlay} class="hlLayer" />
      </div>
      {onPage.length > 0 && (
        <>
          <h2>Highlights on this page, as MayaLib would store them</h2>
          <pre>{onPage.map((h) =>
            `kind: core:highlight\nlocator: {page: ${h.page}}\nquote: ${JSON.stringify(h.quote)}\n` +
            `anchor: {prefix: ${JSON.stringify(h.prefix)}, suffix: ${JSON.stringify(h.suffix)}}\nmethod: ${h.method}\n`).join('---\n')}</pre>
        </>
      )}
    </section>
  );
}
