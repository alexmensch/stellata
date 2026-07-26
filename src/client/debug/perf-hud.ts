// Always-callable instrumentation: mark / measure / frame are no-ops
// until buildPerfSection() runs; dispose() restores them.
// See src/client/debug/README.md.

import {
  MS_PER_FRAME_60,
  colourForAvg,
  fmtMs,
  insertSorted,
  summarize,
  type RingStats,
  type RowDatum,
} from './perf-hud-pure';
import { GpuTimer } from './gpu-timer';

const RING_SIZE = 60;
const DOM_UPDATE_MS = 200;
const MAX_TABLE_ROWS = 8;

// Histogram bar ramp: amber threshold expressed as a fraction of the
// 60Hz frame budget (~11.7 ms at MS_PER_FRAME_60 * 0.7).
const HISTO_AMBER_RATIO = 0.7;
// Histogram visible-height cap as a multiple of MS_PER_FRAME_60 — spikes
// above this clip rather than squashing the rest of the trace.
const HISTO_HEIGHT_CAP_MULT = 2;

interface SectionStats {
  ring: Float32Array;
  idx: number;
  count: number;
  // Last frame index where this section was written. Sections that go
  // dormant (e.g. chart.* after exiting chart mode) get garbage-collected
  // once they've been silent for RING_SIZE frames so the HUD doesn't keep
  // averaging stale ring data.
  lastFrame: number;
}

const sections = new Map<string, SectionStats>();
const starts = new Map<string, number>();
let frameCounter = 0;

// True displayed frame rate, from rAF-to-rAF deltas. NOT derived from
// frame.total: that measures how much work a frame does, and inverting it
// reports e.g. "347 FPS" on a 60 Hz display whenever the work is cheap.
const frameDeltas: RingStats = { ring: new Float32Array(RING_SIZE), idx: 0, count: 0 };
let lastFrameNowMs = 0;

let gpuTimer: GpuTimer | null = null;

let installed = false;
let visible = false;
let panelEl: HTMLDivElement | null = null;
let lastDomUpdateMs = 0;

// Persistent DOM handles populated by buildPerfDom() and mutated each tick.
let captionEl: HTMLDivElement | null = null;
let lastCaptionN = -1;
// Typed headline node refs. The "FPS N " prefix lives on a Text node, the
// "low N" / "gpu N.NNms" segments on their own spans — writing through
// these refs avoids the childNodes / .children index walk that silently
// scrambles when the headline shape changes.
let headlineFpsText: Text | null = null;
let headlineLowSpan: HTMLSpanElement | null = null;
let headlineGpuSpan: HTMLSpanElement | null = null;
const rowPool: { line: HTMLDivElement; label: HTMLSpanElement; values: HTMLSpanElement }[] = [];
const histoBars: HTMLSpanElement[] = [];
// Per-bar last-written height/colour so per-tick writes skip identical
// values — same dirty-tracking pattern chart-labels.ts uses for SVG.
const histoLastHeight: number[] = [];
const histoLastColour: string[] = [];
// Per-row last-written colour. style.color's CSSOM getter returns the
// serialised form (#cfe → rgb(204,238,255)), so comparing against the
// input hex always mismatches; cache the input hex separately. Mirrors
// histoLastColour above.
const rowLastColour: string[] = [];

// Scratch row data reused across ticks. Index 0..N-1 holds the current
// frame's top sections in descending-avg order; only the first N rows
// in rowPool are visible, the rest are display:none.
const rowScratch: RowDatum[] = [];

function ensureSection(label: string): SectionStats {
  let s = sections.get(label);
  if (!s) {
    s = { ring: new Float32Array(RING_SIZE), idx: 0, count: 0, lastFrame: frameCounter };
    sections.set(label, s);
  }
  return s;
}

function realMark(label: string): void {
  starts.set(label, performance.now());
}

function realMeasure(label: string): void {
  const start = starts.get(label);
  if (start === undefined) return;
  recordSample(label, performance.now() - start);
}

// Exported for vitest only — lets the GC behaviour be observed without
// driving the panel through a render loop.
export function _sectionsForTest(): ReadonlyMap<string, SectionStats> {
  return sections;
}

function recordSample(label: string, ms: number): void {
  const s = ensureSection(label);
  s.ring[s.idx] = ms;
  s.idx = (s.idx + 1) % RING_SIZE;
  if (s.count < RING_SIZE) s.count++;
  s.lastFrame = frameCounter;
}

function recordGpuSample(label: string, ms: number): void {
  recordSample(`gpu.${label}`, ms);
}

function realFrame(): void {
  frameCounter++;
  const nowMs = performance.now();
  if (lastFrameNowMs > 0) {
    frameDeltas.ring[frameDeltas.idx] = nowMs - lastFrameNowMs;
    frameDeltas.idx = (frameDeltas.idx + 1) % RING_SIZE;
    if (frameDeltas.count < RING_SIZE) frameDeltas.count++;
  }
  lastFrameNowMs = nowMs;
  gpuTimer?.advanceFrame(recordGpuSample);
  // Drop sections that haven't reported in a full ring-window. Without
  // this, the HUD averages stale data forever (chart.* entries persisted
  // in navigate mode after exiting chart mode).
  for (const [label, s] of sections) {
    if (frameCounter - s.lastFrame > RING_SIZE) sections.delete(label);
  }
  if (!visible || !panelEl) return;
  const now = performance.now();
  if (now - lastDomUpdateMs < DOM_UPDATE_MS) return;
  lastDomUpdateMs = now;
  renderPanel();
}

function realGpuBegin(label: string): void { gpuTimer?.begin(label); }
function realGpuEnd(label: string): void { gpuTimer?.end(label); }

let _mark: (l: string) => void = () => {};
let _measure: (l: string) => void = () => {};
let _frame: () => void = () => {};
let _gpuBegin: (l: string) => void = () => {};
let _gpuEnd: (l: string) => void = () => {};

export function mark(label: string): void { _mark(label); }
export function measure(label: string): void { _measure(label); }
export function frame(): void { _frame(); }

/** Bracket a GPU scope. Records under `gpu.<label>` when the driver
 *  exposes a timer query; otherwise nothing is recorded and the CPU-side
 *  `submit.<label>` measure is all the HUD shows. */
export function gpuBegin(label: string): void { _gpuBegin(label); }
export function gpuEnd(label: string): void { _gpuEnd(label); }

import type { DebugSection } from './debug-panel';

export function buildPerfSection(gl: WebGL2RenderingContext | null): DebugSection {
  if (!installed) {
    installed = true;
    _mark = realMark;
    _measure = realMeasure;
    _frame = realFrame;
    gpuTimer = gl ? GpuTimer.create(gl) : null;
    if (gpuTimer) {
      _gpuBegin = realGpuBegin;
      _gpuEnd = realGpuEnd;
    }
  }

  // Reset DOM handles & per-bar caches so a re-open gets a fresh build.
  rowPool.length = 0;
  histoBars.length = 0;
  histoLastHeight.length = 0;
  histoLastColour.length = 0;
  rowLastColour.length = 0;

  const div = document.createElement('div');
  div.id = 'perf-hud';
  Object.assign(div.style, {
    padding: '8px 10px',
    background: 'rgba(0, 0, 0, 0.85)',
    color: '#cfe',
    font: "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: '1.35',
    borderRadius: '4px',
    minWidth: '240px',
  } as CSSStyleDeclaration);

  // Headline: "FPS NN low NN gpu N.NNms". Three named refs (one Text +
  // two SpanElements) so per-tick writes go through typed locals instead
  // of childNodes / .children index walks that scramble silently if the
  // headline shape ever gains another text node or reorders.
  const headline = document.createElement('div');
  headline.style.fontWeight = '600';
  headline.style.color = '#fff';
  const fpsText = document.createTextNode('');
  headline.appendChild(fpsText);
  const lowSpan = document.createElement('span');
  lowSpan.style.color = '#fc8';
  lowSpan.appendChild(document.createTextNode(''));
  headline.appendChild(lowSpan);
  headline.appendChild(document.createTextNode(' '));
  const gpuSpan = document.createElement('span');
  gpuSpan.style.color = '#8cf';
  gpuSpan.appendChild(document.createTextNode(''));
  headline.appendChild(gpuSpan);
  div.appendChild(headline);
  headlineFpsText = fpsText;
  headlineLowSpan = lowSpan;
  headlineGpuSpan = gpuSpan;

  // Static table header row.
  const header = document.createElement('div');
  Object.assign(header.style, {
    marginTop: '6px',
    display: 'flex',
    justifyContent: 'space-between',
    color: '#888',
    borderBottom: '1px solid #333',
    paddingBottom: '2px',
    marginBottom: '2px',
  } as CSSStyleDeclaration);
  const headerLeft = document.createElement('span');
  headerLeft.textContent = 'section';
  const headerRight = document.createElement('span');
  headerRight.textContent = 'avg / max ms';
  header.appendChild(headerLeft);
  header.appendChild(headerRight);
  div.appendChild(header);

  // Row pool: MAX_TABLE_ROWS pre-allocated rows, hidden until populated.
  const rowsParent = document.createElement('div');
  for (let i = 0; i < MAX_TABLE_ROWS; i++) {
    const line = document.createElement('div');
    line.style.display = 'none';
    line.style.justifyContent = 'space-between';
    const label = document.createElement('span');
    const values = document.createElement('span');
    line.appendChild(label);
    line.appendChild(values);
    rowsParent.appendChild(line);
    rowPool.push({ line, label, values });
    rowLastColour.push('');
  }
  div.appendChild(rowsParent);

  // Histogram chrome + cached bars. Per-tick mutates only style.height /
  // style.background on each existing span — no innerHTML, no createElement.
  const histo = document.createElement('div');
  Object.assign(histo.style, {
    marginTop: '6px',
    height: '24px',
    lineHeight: '0',
    borderBottom: '1px solid #444',
  } as CSSStyleDeclaration);
  for (let i = 0; i < RING_SIZE; i++) {
    const bar = document.createElement('span');
    Object.assign(bar.style, {
      display: 'inline-block',
      width: '3px',
      height: '0px',
      background: '#8df',
      marginRight: '1px',
      verticalAlign: 'bottom',
    } as CSSStyleDeclaration);
    histo.appendChild(bar);
    histoBars.push(bar);
    histoLastHeight.push(-1);
    histoLastColour.push('');
  }
  div.appendChild(histo);

  const caption = document.createElement('div');
  caption.style.color = '#888';
  caption.style.fontSize = '10px';
  caption.textContent = `frame.total · last 0f · 16.7ms ref`;
  div.appendChild(caption);
  captionEl = caption;
  lastCaptionN = -1;

  panelEl = div;
  visible = true;
  return {
    element: div,
    dispose: () => {
      // Re-arm the always-callable no-op contract: every perfMark /
      // perfMeasure / perfFrame call site (stellata.ts animate() loop,
      // chart-labels.ts) keeps calling through the module-level
      // _mark/_measure/_frame, so the cheapest way to make those calls
      // free again is to point those bindings back at no-op stubs.
      _mark = () => {};
      _measure = () => {};
      _frame = () => {};
      _gpuBegin = () => {};
      _gpuEnd = () => {};
      installed = false;
      gpuTimer?.dispose();
      gpuTimer = null;
      sections.clear();
      starts.clear();
      frameCounter = 0;
      frameDeltas.ring.fill(0);
      frameDeltas.idx = 0;
      frameDeltas.count = 0;
      lastFrameNowMs = 0;
      lastDomUpdateMs = 0;
      visible = false;
      panelEl = null;
      headlineFpsText = null;
      headlineLowSpan = null;
      headlineGpuSpan = null;
      captionEl = null;
      lastCaptionN = -1;
    },
    setVisible: (v: boolean) => {
      visible = v && panelEl !== null;
    },
  };
}

function renderPanel(): void {
  if (!panelEl || !headlineFpsText || !headlineLowSpan || !headlineGpuSpan) return;

  const total = sections.get('frame.total');

  // Displayed rate from real rAF deltas; `low` is the slowest frame in
  // the window, so it is the inverse of the MAX delta.
  const deltaStats = summarize(frameDeltas);
  const fpsAvg = deltaStats.avg > 0 ? 1000 / deltaStats.avg : 0;
  const fpsLow = deltaStats.max > 0 ? 1000 / deltaStats.max : 0;

  // With a timer query the headline is real GPU execution summed over
  // the rotating scopes; without one it can only be CPU submission
  // wall-time, and says so.
  let busyLabel = 'submit';
  let busyMs = 0;
  if (gpuTimer) {
    busyLabel = 'gpu';
    for (const scope of gpuTimer.scopeLabels()) {
      const s = sections.get(`gpu.${scope}`);
      if (s) busyMs += summarize(s).avg;
    }
  } else {
    for (const [label, s] of sections) {
      if (label.startsWith('submit.')) busyMs += summarize(s).avg;
    }
  }

  headlineFpsText.nodeValue = `FPS ${fpsAvg.toFixed(0)} `;
  headlineLowSpan.firstChild!.nodeValue = `low ${fpsLow.toFixed(0)}`;
  headlineGpuSpan.firstChild!.nodeValue = `${busyLabel} ${fmtMs(busyMs)}ms`;

  // Single-pass row build: walk the sections map once, summarise, and
  // insertion-sort into rowScratch (only need the top MAX_TABLE_ROWS so
  // the partial sort is bounded by MAX_TABLE_ROWS × sections-count
  // comparisons regardless of total section count).
  rowScratch.length = 0;
  for (const [label, s] of sections) {
    if (label === 'frame.total') continue;
    const stats = summarize(s);
    insertSorted(rowScratch, { label, avg: stats.avg, max: stats.max }, MAX_TABLE_ROWS);
  }

  // Project rowScratch into the row pool: visible rows update, the rest
  // hide. textContent/colour writes are still cheap, but skip identical
  // text to spare DOM mutations on stable workloads.
  for (let i = 0; i < MAX_TABLE_ROWS; i++) {
    const slot = rowPool[i];
    if (i >= rowScratch.length) {
      if (slot.line.style.display !== 'none') slot.line.style.display = 'none';
      continue;
    }
    const r = rowScratch[i];
    if (slot.line.style.display !== 'flex') slot.line.style.display = 'flex';
    if (slot.label.textContent !== r.label) slot.label.textContent = r.label;
    const valStr = `${fmtMs(r.avg)} / ${fmtMs(r.max)}`;
    if (slot.values.textContent !== valStr) slot.values.textContent = valStr;
    const colour = colourForAvg(r.avg);
    if (rowLastColour[i] !== colour) {
      slot.line.style.color = colour;
      rowLastColour[i] = colour;
    }
  }

  // Histogram: write only the bars that changed. Cap at 2× the 60Hz frame
  // budget so spikes don't squash the rest of the trace beyond legibility.
  if (total && total.count > 0) {
    const N = total.count;
    const start = (total.idx - N + RING_SIZE) % RING_SIZE;
    const cap = MS_PER_FRAME_60 * HISTO_HEIGHT_CAP_MULT;
    const amberMs = MS_PER_FRAME_60 * HISTO_AMBER_RATIO;
    if (captionEl && lastCaptionN !== N) {
      captionEl.textContent = `frame.total · last ${N}f · 16.7ms ref`;
      lastCaptionN = N;
    }
    for (let i = 0; i < RING_SIZE; i++) {
      const bar = histoBars[i];
      if (i >= N) {
        if (histoLastHeight[i] !== 0) {
          bar.style.height = '0px';
          histoLastHeight[i] = 0;
        }
        continue;
      }
      const v = total.ring[(start + i) % RING_SIZE];
      const h = Math.min(1, v / cap);
      // 0.1 px quantisation to skip writes that wouldn't visually differ
      // — toFixed(1) below truncates the same way.
      const heightPx = Math.round(h * 240) / 10;
      const colour =
        v > MS_PER_FRAME_60 ? '#f88' :
        v > amberMs ? '#fc8' :
        '#8df';
      if (histoLastHeight[i] !== heightPx) {
        bar.style.height = `${heightPx}px`;
        histoLastHeight[i] = heightPx;
      }
      if (histoLastColour[i] !== colour) {
        bar.style.background = colour;
        histoLastColour[i] = colour;
      }
    }
  } else {
    for (let i = 0; i < RING_SIZE; i++) {
      if (histoLastHeight[i] !== 0) {
        histoBars[i].style.height = '0px';
        histoLastHeight[i] = 0;
      }
    }
  }
}
