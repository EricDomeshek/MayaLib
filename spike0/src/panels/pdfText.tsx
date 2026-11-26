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
// Selections can also end on an element boundary (e.g. the text-layer div itself, or a <br>
// at a line end, as when a drag runs to the end of a line); map those to the nearest run.
function toOffset(ps: PageState, node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const i = ps.textDivs.findIndex((d) => d.contains(node));
    return i < 0 ? null : ps.starts[i] + offset;
  }
  const el = node as Element;
  const own = ps.textDivs.findIndex((d) => d === el || d.contains(el));
  if (own >= 0) return ps.starts[own] + (offset > 0 ? (ps.textDivs[own].textContent?.length ?? 0) : 0);
  // Boundary between children of a container: use the first run at or after that child.
  const child = el.childNodes[offset] ?? null;
  for (let n: Node | null = child; n; n = n.nextSibling) {
    const i = ps.textDivs.findIndex((d) => d === n || (n as Element).contains?.(d));
    if (i >= 0) return ps.starts[i];
  }
  return el.closest?.('.textLayer') || el.querySelector?.('.textLayer') ? ps.pageText.length : null;
}

// Map an offset in pageText back to a DOM position.
// pdf.js emits empty runs at line ends (no text node, and sharing their start offset with the
// following run), so skip runs without text; an offset at the very end of a run, or in a
// virtual separator, maps to the end of the preceding non-empty run.
function toDom(ps: PageState, off: number): [Node, number] | null {
  for (let i = ps.textDivs.length - 1; i >= 0; i--) {
    const t = ps.textDivs[i].firstChild;
    if (!t || t.nodeType !== Node.TEXT_NODE || !t.textContent) continue;
    if (ps.starts[i] <= off) return [t, Math.min(off - ps.starts[i], t.textContent.length)];
  }
  return null;
}

// Find the quote again, using prefix/suffix to choose between repeated occurrences.
function locate(ps: PageState, h: Highlight): [number, number] | null {
  if (!h.quote) return null;
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
  // Last non-empty selection on the page, captured as it changes. iOS clears the selection when a
  // button is tapped, before the button's handler runs, so Save highlight falls back to this.
  const lastSel = useRef<{ s: number; e: number; page: number; at: number } | null>(null);
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
    lastSel.current = null;
    tapStart.current = null;
    tapMark.current = null;
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
    try { drawHighlightsInner(list); } catch (e) { say(`✘ drawing highlights failed: ${errText(e)}`); record(P, 'drawError', errText(e)); }
  }

  function drawHighlightsInner(list: Highlight[]) {
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

  // Convert the current DOM selection to pageText offsets, or explain why it can't be.
  function selectionOffsets(st: PageState): { s: number; e: number } | string | null {
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    const s = toOffset(st, r.startContainer, r.startOffset);
    const e = toOffset(st, r.endContainer, r.endOffset);
    if (s === null || e === null) {
      const d = (n: Node) => n.nodeType === Node.TEXT_NODE ? `text in <${n.parentElement?.tagName.toLowerCase()} class="${n.parentElement?.className}">` : `<${(n as Element).tagName?.toLowerCase()} class="${(n as Element).className}">`;
      return `Selection is outside the page text (start: ${d(r.startContainer)} @${r.startOffset}; end: ${d(r.endContainer)} @${r.endOffset}).`;
    }
    return s <= e ? { s, e } : { s: e, e: s };
  }

  useEffect(() => {
    const onSel = () => {
      const st = ps.current;
      if (!st) return;
      const o = selectionOffsets(st);
      if (o && typeof o !== 'string' && o.e > o.s) lastSel.current = { ...o, page: st.page, at: Date.now() };
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  async function saveFromSelection(method: 'native' | 'tap') {
    try { await saveInner(method); } catch (e) { say(`✘ saving failed: ${errText(e)}`); record(P, 'saveError', errText(e)); }
  }

  async function saveInner(method: 'native' | 'tap') {
    const st = ps.current;
    const sel = getSelection();
    if (!st) { say('Page not ready yet (text layer still loading).'); return; }
    let source = 'live selection';
    let o = selectionOffsets(st);
    if (typeof o === 'string') { say(o); return; }
    if (!o) {
      const last = lastSel.current;
      if (last && last.page === st.page && Date.now() - last.at < 120_000) {
        o = { s: last.s, e: last.e };
        source = 'remembered selection (the tap cleared the live one)';
      } else {
        say('Select some text on the page first.');
        return;
      }
    }
    await saveOffsets(st, o.s, o.e, method, source);
  }

  // Shared by selection-based and tap-based highlighting: offsets in pageText → stored highlight.
  async function saveOffsets(st: PageState, s0: number, e0: number, method: 'native' | 'tap', source: string) {
    let s = Math.min(s0, e0), e = Math.max(s0, e0);
    // Trim whitespace (including virtual separators) from both ends of the selection.
    while (s < e && /\s/.test(st.pageText[s])) s++;
    while (e > s && /\s/.test(st.pageText[e - 1])) e--;
    const quote = st.pageText.slice(s, e);
    if (!quote.trim()) { say(`Empty selection (offsets ${s}–${e}).`); return; }
    const h: Highlight = {
      id: `${Date.now()}`, page: st.page, quote,
      prefix: st.pageText.slice(Math.max(0, s - CONTEXT), s),
      suffix: st.pageText.slice(e, e + CONTEXT),
      method, createdAt: new Date().toISOString(),
    };
    const next = [...hlRef.current, h];
    await kvSet(docKey.current, next);
    setHighlights(next);
    getSelection()?.removeAllRanges();
    lastSel.current = null;
    say(`Saved highlight (${method}, from ${source}): “${quote.slice(0, 80)}${quote.length > 80 ? '…' : ''}”`);
    record(P, `saved_${h.id}`, { page: h.page, chars: quote.length, method, source });
  }

  // Tap mode: tap the first word, then the last word; MayaLib builds the highlight from the two taps.
  // Uses pointer events (iOS may not deliver click for taps on text), ignores drags, marks the first
  // word visibly, and saves straight from offsets so it doesn't depend on the browser's selection.
  const down = useRef<{ x: number; y: number } | null>(null);
  const tapMark = useRef<HTMLDivElement | null>(null);

  function clearTapMark() {
    tapMark.current?.remove();
    tapMark.current = null;
  }

  function markWord(st: PageState, s: number, e: number) {
    clearTapMark();
    const a = toDom(st, s), b = toDom(st, e);
    if (!a || !b || !overlay.current || !wrap.current) return;
    const r = document.createRange();
    r.setStart(a[0], a[1]);
    r.setEnd(b[0], b[1]);
    const rect = r.getBoundingClientRect();
    const box = wrap.current.getBoundingClientRect();
    const m = document.createElement('div');
    m.className = 'tapmark';
    Object.assign(m.style, { left: `${rect.left - box.left - 2}px`, top: `${rect.top - box.top - 2}px`, width: `${rect.width + 4}px`, height: `${rect.height + 4}px` });
    overlay.current.appendChild(m);
    tapMark.current = m;
  }

  function onPointerDown(ev: PointerEvent) {
    down.current = { x: ev.clientX, y: ev.clientY };
  }

  function onPointerUp(ev: PointerEvent) {
    if (!tapMode || !ps.current) return;
    const d = down.current;
    down.current = null;
    if (d && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 12) return; // a drag/scroll, not a tap
    const st = ps.current;
    const c = charAt(st, ev.clientX, ev.clientY);
    const off = c && toOffset(st, c[0], c[1]);
    if (off === null || off === undefined) { say('Tap landed between words; tap directly on a word.'); return; }
    ev.preventDefault();
    const text = st.pageText;
    if (tapStart.current === null) {
      let s = off, e = off;
      while (s > 0 && /\S/.test(text[s - 1])) s--;
      while (e < text.length && /\S/.test(text[e])) e++;
      tapStart.current = s;
      markWord(st, s, e);
      say(`Start set at “${text.slice(s, e)}”. Now tap the last word.`);
      return;
    }
    let s = tapStart.current, e = off;
    if (e < s) {
      // Tapped before the start: treat the earlier word as the start.
      const t = s; s = e; e = t;
      while (s > 0 && /\S/.test(text[s - 1])) s--;
    }
    while (e < text.length && /\S/.test(text[e])) e++;
    tapStart.current = null;
    clearTapMark();
    saveOffsets(st, s, e, 'tap', 'two taps').catch((err) => say(`✘ saving failed: ${errText(err)}`));
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
          <button disabled={busy} onClick={() => { setTapMode(!tapMode); tapStart.current = null; clearTapMark(); }}>
            Tap mode: {tapMode ? 'ON' : 'off'}
          </button>
          <button disabled={busy || highlights.length === 0} onClick={clearAll}>Clear highlights</button>
        </div>
      )}
      {/* Fixed height: a growing log would shift the page between the two taps of Tap mode. */}
      <pre style="height:9em">{log.join('\n') || 'No PDF loaded.'}</pre>
      <div class={`pdfPage${tapMode ? ' tapmode' : ''}`} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
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
