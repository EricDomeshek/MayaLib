import { EnvPanel } from './panels/env';
import { DrivePanel } from './panels/drive';
import { SqlitePanel } from './panels/sqlite';
import { PdfPanel } from './panels/pdf';
import { PdfTextPanel } from './panels/pdfText';
import { CapturePanel } from './panels/capture';
import { ResultsPanel } from './panels/resultsPanel';

export function App() {
  return (
    <main>
      <h1>MayaLib — Spike 0</h1>
      <p class="muted">
        Throwaway feasibility tests (design D19). Run each section on each device, then copy the
        report at the bottom and send it back. Build {__BUILD_TIME__}.
      </p>
      <nav>
        <a href="#env">Device</a>
        <a href="#drive">Drive</a>
        <a href="#sqlite">SQLite</a>
        <a href="#pdf">PDF</a>
        <a href="#pdftext">Highlights</a>
        <a href="#capturetest">Capture</a>
        <a href="#results">Report</a>
      </nav>
      <EnvPanel />
      <DrivePanel />
      <SqlitePanel />
      <PdfPanel />
      <PdfTextPanel />
      <CapturePanel />
      <ResultsPanel />
    </main>
  );
}
