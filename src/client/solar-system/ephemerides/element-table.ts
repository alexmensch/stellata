// Runtime side of data/ephemerides/{planet}.json: a uniform-cadence table of
// equinoctial elements plus its interpolating sampler. See README.md
// § Horizons element tables.

import {
  ELEMENT_STRIDE,
  type PlanetElementTableFile,
} from '../../../../scripts/ephemerides/planet-element-schema';
import type { EquinoctialElements } from './equinoctial-pure';

export interface PlanetElementTable {
  readonly id: string;
  /** Julian Date TDB of sample 0. */
  readonly jd0: number;
  readonly stepDays: number;
  readonly count: number;
  /** Julian Date TDB of the last sample. */
  readonly jdLast: number;
  /** `ELEMENT_STRIDE` columns per sample, in `ELEMENT_COLUMNS` order. */
  readonly samples: Float64Array;
  readonly positionToleranceAu: number;
}

/** Parse one wire file into a flat Float64Array. float64 rather than float32
 *  throughout: an unwrapped mean longitude reaches ~3e5 degrees at Mercury,
 *  where float32's 0.02° resolution would be four orders coarser than the
 *  1e-4° the table's accuracy claim needs. */
export function buildElementTable(file: PlanetElementTableFile): PlanetElementTable {
  const count = file.samples.length;
  if (count < 2) throw new Error(`Element table ${file.id} has ${count} samples`);
  if (!(file.stepDays > 0)) throw new Error(`Element table ${file.id} has step ${file.stepDays}`);
  const samples = new Float64Array(count * ELEMENT_STRIDE);
  for (let i = 0; i < count; i++) {
    const row = file.samples[i];
    if (row.length !== ELEMENT_STRIDE) {
      throw new Error(`Element table ${file.id} sample ${i} has ${row.length} columns`);
    }
    for (let c = 0; c < ELEMENT_STRIDE; c++) {
      const v = row[c];
      if (!Number.isFinite(v)) {
        throw new Error(`Element table ${file.id} sample ${i} column ${c} is not finite`);
      }
      samples[i * ELEMENT_STRIDE + c] = v;
    }
  }
  return {
    id: file.id,
    jd0: file.jd0,
    stepDays: file.stepDays,
    count,
    jdLast: file.jd0 + (count - 1) * file.stepDays,
    samples,
    positionToleranceAu: file.positionToleranceAu,
  };
}

/** Catmull–Rom through `p1`/`p2` at fraction `f`, tangents from `p0`/`p3`. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, f: number): number {
  return p1 + 0.5 * f * (
    (p2 - p0)
    + f * ((2 * p0 - 5 * p1 + 4 * p2 - p3)
      + f * (3 * (p1 - p2) + p3 - p0))
  );
}

/** One column of `elementTableSampleAt`'s spline, from the four row offsets
 *  it resolved. `b0`/`b3` are -1 in the boundary intervals, where the missing
 *  outer control point is extrapolated rather than clamped. */
function splineColumn(
  s: Float64Array,
  b0: number, b1: number, b2: number, b3: number,
  c: number,
  f: number,
): number {
  const p1 = s[b1 + c];
  const p2 = s[b2 + c];
  return catmullRom(
    b0 >= 0 ? s[b0 + c] : 2 * p1 - p2,
    p1,
    p2,
    b3 >= 0 ? s[b3 + c] : 2 * p2 - p1,
    f,
  );
}

/**
 * Interpolated elements at Julian Date TDB `jd` into `out`; false (and `out`
 * untouched) outside the table's span.
 *
 * The cadence is uniform, so the bracketing interval is an index computation
 * rather than a search — no cursor to invalidate when a scrub jumps decades
 * between frames — and it is what lets a Catmull–Rom spline read its four
 * control points by offset. Cubic rather than linear because the residual
 * scales as step⁴ instead of step²: at equal accuracy the outer-planet tables
 * are several times coarser, which is the whole artifact-size budget
 * (`../../../../data/ephemerides/README.md` § Cadence).
 *
 * In the first and last interval the missing outer control point is
 * **extrapolated** (`2·p1 − p2`), not clamped to the endpoint. Clamping halves
 * the end tangent, and for the one column that advances by whole degrees per
 * step — the mean longitude — that misplaces Mercury by 6° in the table's
 * first 25 days.
 */
export function elementTableSampleAt(
  table: PlanetElementTable,
  jd: number,
  out: EquinoctialElements,
): boolean {
  if (jd < table.jd0 || jd > table.jdLast) return false;
  const grid = (jd - table.jd0) / table.stepDays;
  const i = Math.min(Math.floor(grid), table.count - 2);
  const f = grid - i;
  const s = table.samples;
  const b1 = i * ELEMENT_STRIDE;
  const b2 = b1 + ELEMENT_STRIDE;
  const b0 = i > 0 ? b1 - ELEMENT_STRIDE : -1;
  const b3 = i + 2 < table.count ? b2 + ELEMENT_STRIDE : -1;
  out.aAu = splineColumn(s, b0, b1, b2, b3, 0, f);
  out.h = splineColumn(s, b0, b1, b2, b3, 1, f);
  out.k = splineColumn(s, b0, b1, b2, b3, 2, f);
  out.p = splineColumn(s, b0, b1, b2, b3, 3, f);
  out.q = splineColumn(s, b0, b1, b2, b3, 4, f);
  out.lambdaDeg = splineColumn(s, b0, b1, b2, b3, 5, f);
  return true;
}
