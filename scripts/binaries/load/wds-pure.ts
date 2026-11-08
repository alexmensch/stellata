// The WDS summary and ORB6 fixed-width formats: pair rows, orbit rows, and the duplicate-row collapse.

import { RA_HOURS_TO_DEG } from '../../../src/astro-core/astronomy-constants';
import type { SkyPosition } from '../../../src/astro-core/equatorial-basis';
import type { Declared } from '../../util/sources/source';
import { floatCell, intCell } from '../../util/tsv/table-pure';

export interface WdsPair {
  /** `HHMMm±DDMM`. */
  readonly wdsId: string;
  readonly discoverer: string;
  /** `AB`, `AC`, `Aa,Ab`; blank is WDS's implied single A,B pair. */
  readonly components: string;
  readonly dateLast: number | null;
  readonly rhoLast: number | null;
  readonly thetaLast: number | null;
  readonly magPri: number | null;
  readonly magSec: number | null;
  readonly spectral: string;
  /** The 4-character flag block (cols 107-110), unstripped. */
  readonly notes: string;
  readonly precise: SkyPosition | null;
  readonly nObs: number | null;
  readonly dateFirst: number | null;
  readonly thetaFirst: number | null;
  readonly rhoFirst: number | null;
}

/** A Sixth Orbit Catalog row; unit codes kept verbatim for Stage 4 to normalise. */
export interface Orb6Entry {
  readonly wdsId: string;
  readonly discoverer: string;
  readonly components: string;
  readonly hd: number | null;
  readonly hip: number | null;
  readonly pVal: number | null;
  readonly pUnit: string;
  readonly aVal: number | null;
  readonly aUnit: string;
  readonly iDeg: number | null;
  /** Ω, the ascending node. */
  readonly nodeDeg: number | null;
  /** ω, the argument of periastron. */
  readonly periastronDeg: number | null;
  readonly e: number | null;
  readonly t0Val: number | null;
  readonly t0Unit: string;
  /** 1-5 visual (definitive → indeterminate), 7-9 non-visual. */
  readonly grade: number;
  readonly ref: string;
  /** ORB6's own J2000 coordinate prefix (cols 1-18). */
  readonly precise: SkyPosition | null;
}

export interface Orb6Parse {
  readonly entries: readonly Orb6Entry[];
  /** Rows whose grade cell is not a digit, read as grade 5. */
  readonly gradeFallbacks: number;
}

/** ρ's field-overflow sentinel: WDS writes exactly 999.9 when the separation
 *  outruns the 5-character field (α Cen A–Proxima), so it cannot place the
 *  secondary. A negative ρ or θ is the no-measurement sentinel (Spica). */
export const WDS_RHO_OVERFLOW_SENTINEL_ARCSEC = 999.9;

/** A coverage drop below these means the fixed-width offsets shifted. */
export const WDS_SUMM_PRECISE_COORD_FLOOR = 0.95;
export const ORB6_PERIOD_COVERAGE_FLOOR = 0.90;

const ORB6_FALLBACK_GRADE = 5;
const WDS_LINE_WIDTH = 130;
const ORB6_LINE_WIDTH = 264;
const WDS_HEADER = /^[A-Za-z<]/;
const PY_INT = /^\s*[+-]?\d+\s*$/;

type CellParse = (raw: string) => number | null;

/** README.md#how-the-readers-read */
class FixedWidthLine {
  constructor(
    private readonly from: Declared,
    private readonly lineNo: number,
    readonly text: string,
  ) {}

  slice(start: number, end: number): string {
    return this.text.slice(start, end);
  }

  float(field: string, start: number, end: number): number | null {
    return this.cell(field, start, end, floatCell);
  }

  int(field: string, start: number, end: number): number | null {
    return this.cell(field, start, end, intCell);
  }

  /** ρ or θ, both sentinels read as no measurement. */
  sepPa(field: string, start: number, end: number): number | null {
    const v = this.float(field, start, end);
    return v === null || v < 0 || v >= WDS_RHO_OVERFLOW_SENTINEL_ARCSEC ? null : v;
  }

  private cell(field: string, start: number, end: number, parse: CellParse): number | null {
    const raw = this.text.slice(start, end).trim();
    if (raw === '.') return null;
    try {
      return parse(raw);
    } catch (e) {
      throw new Error(`${this.from.file}:${this.lineNo}: ${field}: ${(e as Error).message}. ${this.from.hint}`);
    }
  }
}

function* fixedWidthLines(text: string, from: Declared, width: number, keep: (line: string) => boolean): Generator<FixedWidthLine> {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (line === '' || !keep(line)) continue;
    yield new FixedWidthLine(from, i + 1, line.padEnd(width));
  }
}

/** `HHMMSS.SS±DDMMSS.S` → RA/Dec degrees; null when any part does not parse,
 *  read the way Python's `int` / `float` read each slice of the stripped field. */
export function parsePreciseCoord(field: string): SkyPosition | null {
  const s = field.trim();
  if (s.length < 17) return null;
  const ints = [s.slice(0, 2), s.slice(2, 4), s.slice(10, 12), s.slice(12, 14)];
  const floats = [s.slice(4, 9), s.slice(14)];
  if (!ints.every((t) => PY_INT.test(t))) return null;
  const parsed = floats.map((t) => {
    try {
      return floatCell(t);
    } catch {
      return null;
    }
  });
  if (parsed.some((v) => v === null)) return null;
  const [raH, raM, decD, decM] = ints.map(Number);
  const [raS, decS] = parsed as number[];
  const sign = s[9] === '-' ? -1 : 1;
  return {
    raDeg: (raH + raM / 60.0 + raS / 3600.0) * RA_HOURS_TO_DEG,
    decDeg: sign * (decD + decM / 60.0 + decS / 3600.0),
  };
}

function assertCoverage<T>(rows: readonly T[], from: Declared, field: string, present: (r: T) => boolean, floor: number): void {
  if (rows.length === 0) return;
  const ok = rows.filter(present).length;
  const rate = ok / rows.length;
  if (rate < floor) {
    throw new Error(
      `${from.file}: '${field}' non-null rate ${(rate * 100).toFixed(1)}% (${ok}/${rows.length}) below `
        + `${floor * 100}% floor — likely a column-offset drift; re-verify the fixed-width layout. ${from.hint}`,
    );
  }
}

export function parseWdsSumm(text: string, from: Declared): WdsPair[] {
  const keep = (line: string): boolean => line.length >= 22 && !WDS_HEADER.test(line) && PY_INT.test(line.slice(0, 5));
  const pairs: WdsPair[] = [];
  for (const l of fixedWidthLines(text, from, WDS_LINE_WIDTH, keep)) {
    const wdsId = l.slice(0, 10).trim();
    const discoverer = l.slice(10, 17).trim();
    if (!wdsId || !discoverer) continue;
    pairs.push({
      wdsId,
      discoverer,
      components: l.slice(17, 22).trim(),
      dateLast: l.int('date_last', 28, 32),
      thetaLast: l.sepPa('theta_last', 42, 45),
      rhoLast: l.sepPa('rho_last', 52, 57),
      magPri: l.float('mag_pri', 58, 63),
      magSec: l.float('mag_sec', 64, 69),
      spectral: l.slice(70, 79).trim(),
      notes: l.slice(107, 111),
      precise: parsePreciseCoord(l.slice(112, 130)),
      nObs: l.int('n_obs', 33, 37),
      dateFirst: l.int('date_first', 23, 27),
      thetaFirst: l.sepPa('theta_first', 38, 41),
      rhoFirst: l.sepPa('rho_first', 46, 51),
    });
  }
  assertCoverage(pairs, from, 'precise', (p) => p.precise !== null, WDS_SUMM_PRECISE_COORD_FLOOR);
  return pairs;
}

export function parseOrb6(text: string, from: Declared): Orb6Parse {
  const keep = (line: string): boolean => {
    if (line.length < 30) return false;
    return /^\d/.test(line.slice(0, 9).trim());
  };
  const entries: Orb6Entry[] = [];
  let gradeFallbacks = 0;
  for (const l of fixedWidthLines(text, from, ORB6_LINE_WIDTH, keep)) {
    const wdsId = l.slice(19, 29).trim();
    if (!wdsId) continue;
    const gradeCell = l.slice(233, 234).trim();
    const graded = /^\d$/.test(gradeCell);
    if (!graded) gradeFallbacks++;
    entries.push({
      wdsId,
      discoverer: l.slice(30, 37).trim(),
      components: l.slice(37, 44).trim(),
      precise: parsePreciseCoord(l.slice(0, 18)),
      hd: l.int('hd', 51, 57),
      hip: l.int('hip', 58, 64),
      // P and ω are right-justified on a fixed decimal point, so a value with
      // more integer digits overflows one column left of the nominal edge.
      pVal: l.float('P', 80, 92),
      pUnit: l.slice(92, 93).trim(),
      aVal: l.float('a', 105, 114),
      aUnit: l.slice(114, 115).trim(),
      iDeg: l.float('i', 125, 133),
      nodeDeg: l.float('Omega', 143, 151),
      periastronDeg: l.float('omega', 204, 213),
      e: l.float('e', 187, 195),
      t0Val: l.float('T0', 162, 174),
      t0Unit: l.slice(174, 175).trim(),
      grade: graded ? Number(gradeCell) : ORB6_FALLBACK_GRADE,
      ref: l.slice(237, 245).trim(),
    });
  }
  assertCoverage(entries, from, 'P', (e) => e.pVal !== null, ORB6_PERIOD_COVERAGE_FLOOR);
  return { entries, gradeFallbacks };
}

export function dedupWdsPairRows(pairs: readonly WdsPair[]): { pairs: readonly WdsPair[]; dropped: number } {
  const best = new Map<string, number>();
  pairs.forEach((p, i) => {
    const key = `${p.wdsId}\u0000${p.discoverer}\u0000${p.components}`;
    const j = best.get(key);
    if (j === undefined || (p.nObs ?? 0) > (pairs[j].nObs ?? 0)) best.set(key, i);
  });
  const keep = new Set(best.values());
  if (keep.size === pairs.length) return { pairs, dropped: 0 };
  return { pairs: pairs.filter((_, i) => keep.has(i)), dropped: pairs.length - keep.size };
}
