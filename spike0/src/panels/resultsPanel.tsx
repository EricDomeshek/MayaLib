import { useState } from 'preact/hooks';
import { report, useResults } from '../results';

export function ResultsPanel() {
  useResults();
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const text = JSON.stringify({ ...report(), note }, null, 2);

  function download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `spike0-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section id="results">
      <h2>6. Report</h2>
      <p class="muted">Add a note (device name, anything you observed), then copy or download the report and send it back.</p>
      <input type="text" placeholder="e.g. Boox Note Air, Chrome, installed app" value={note}
        onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
      <div class="row">
        <button onClick={() => navigator.clipboard.writeText(text).then(() => setMsg('Copied.'), () => setMsg('Copy failed; use Download.'))}>Copy report</button>
        <button onClick={download}>Download report</button>
        {msg && <span>{msg}</span>}
      </div>
      <pre>{text}</pre>
    </section>
  );
}
