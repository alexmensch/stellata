// Pure helpers for perf-hud: ring-buffer summary, top-N insertion sort,
// row-colour ramp, ms formatter. No DOM, no module state.

export const MS_PER_FRAME_60 = 1000 / 60;

// Row-colour ramp threshold — amber when average ms approaches the 60Hz
// budget. Absolute (not a fraction of the budget) so the rows colour amber
// a touch earlier than the histogram bars, keeping the at-a-glance summary
// trailing-pessimistic.
export const AVG_AMBER_MS = 4;

export interface RingStats {
  ring: Float32Array;
  idx: number;
  count: number;
}

export interface RowDatum {
  label: string;
  avg: number;
  max: number;
}

export function summarize(s: RingStats): { avg: number; max: number } {
  if (s.count === 0) return { avg: 0, max: 0 };
  let sum = 0;
  let max = 0;
  for (let i = 0; i < s.count; i++) {
    const v = s.ring[i];
    sum += v;
    if (v > max) max = v;
  }
  return { avg: sum / s.count, max };
}

export function fmtMs(v: number): string {
  return v.toFixed(v >= 10 ? 1 : 2);
}

export function colourForAvg(avg: number): string {
  return avg > MS_PER_FRAME_60 ? '#f88' : avg > AVG_AMBER_MS ? '#fc8' : '#cfe';
}

// Insertion into a fixed-cap descending-by-avg array. Walk the existing
// rows once, find insert position, splice (drops the last one when at cap).
// For ≤8 visible rows this is cheaper than a full sort over N sections.
export function insertSorted(arr: RowDatum[], r: RowDatum, cap: number): void {
  let pos = arr.length;
  for (let i = 0; i < arr.length; i++) {
    if (r.avg > arr[i].avg) { pos = i; break; }
  }
  if (pos === cap) return;
  arr.splice(pos, 0, r);
  if (arr.length > cap) arr.length = cap;
}
