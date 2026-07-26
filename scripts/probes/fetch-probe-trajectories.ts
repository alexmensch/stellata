// Fetches each roster probe's state vectors from JPL Horizons onto an
// adaptive grid and writes data/probes/{id}.json. Manual + infrequent
// (`pnpm run fetch:probes`); README.md § Adaptive grid.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import { roundSignificant, serializeRowFile } from '../util/frozen-json';

import {
  BASE_STEP_MICRODAYS,
  MIN_STEP_MICRODAYS,
  MAX_REFINE_DEPTH,
  chordMissAu,
  decimateByChordError,
  hermiteBulgeAu,
  jdOfMicrodays,
  microdaysOf,
  planEpochRequests,
  type VectorRow,
} from './adaptive-grid-pure';
import {
  MAX_LIST_EPOCHS,
  MAX_RANGE_ROWS,
  fetchSpanEndpoints,
  fetchVectorRows,
} from './horizons-client';
import type { HorizonsVectorsHeader } from './horizons-vectors';
import { PROBE_MISSIONS, type ProbeMission } from './probe-roster';
import { probeTrajectoryFilename } from './sync-probes-pure';
import {
  PROBE_SAMPLE_COLUMNS,
  type ProbeTrajectoryFile,
} from './probe-trajectory-schema';

const OUT_DIR = resolve(REPO_ROOT, 'data/probes');

/** Last epoch the JPL spacecraft SPKs cover; all five reach it. */
const STOP_TIME = '2050-01-01';

/**
 * Largest distance, AU, the emitted grid may put its linear interpolation
 * from the real trajectory. 1,496 km — under every closest-approach
 * distance in the fleet, the tightest being Voyager 2's 4,950 km at
 * Neptune, so a rendered swing-by bends at the planet rather than near it.
 */
const CHORD_TOLERANCE_AU = 1e-5;

/** The measured error can exceed the tolerance where refinement judged an
 *  interval by its midpoint and the true worst point sits elsewhere. Past
 *  this the grid is not doing what it claims and the run is a failure. */
const VERIFY_LIMIT_AU = CHORD_TOLERANCE_AU * 3;

/**
 * Significant digits kept per emitted coordinate, down from Horizons' 16.
 * At 200 AU that is ~150 m — four orders below the chord tolerance the
 * grid is built to, and it trades ~30% of file size for nothing visible.
 */
const OUTPUT_PRECISION = 11;

/** Epochs are exact integer microdays; 6 decimals reproduces them and no
 *  significant-digit rounding may be applied to a 7-digit JD. */
const JD_DECIMALS = 6;

function round(v: number): number {
  return roundSignificant(v, OUTPUT_PRECISION);
}

function unixMs(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`Unparseable roster date: ${iso}`);
  return ms;
}

/** Accumulates every epoch fetched for one probe, keyed by microday. */
class SampleSet {
  readonly rows = new Map<number, VectorRow>();
  header: HorizonsVectorsHeader | null = null;
  fetched = 0;
  requests = 0;

  constructor(private readonly probe: ProbeMission) {}

  at(mu: number): VectorRow {
    const row = this.rows.get(mu);
    if (row === undefined) throw new Error(`No sample fetched for epoch ${mu}`);
    return row;
  }

  async load(mus: number[]): Promise<void> {
    const missing = [...new Set(mus.filter((mu) => !this.rows.has(mu)))].sort((a, b) => a - b);
    if (missing.length === 0) return;
    for (const request of planEpochRequests(missing, MAX_RANGE_ROWS, MAX_LIST_EPOCHS)) {
      const { header, rows } = await fetchVectorRows(this.probe.horizonsId, request);
      this.header ??= header;
      for (const row of rows) this.rows.set(microdaysOf(row[0]), row);
      this.fetched += rows.length;
      this.requests++;
    }
  }
}

type Interval = { a: number; b: number };

/**
 * Bisects the base grid until linear interpolation across every surviving
 * interval holds `CHORD_TOLERANCE_AU`, keeping only the midpoints that
 * earned their place. Each round is one measurement of the current guess
 * and one correction to it, so the grid ends up dense exactly where the
 * trajectory turns.
 */
async function refine(samples: SampleSet, base: number[]): Promise<Set<number>> {
  const kept = new Set(base);
  let open: Interval[] = base.slice(0, -1).map((a, i) => ({ a, b: base[i + 1] }));
  for (let depth = 1; depth <= MAX_REFINE_DEPTH && open.length > 0; depth++) {
    const splittable = open.filter(({ a, b }) => b - a >= 2 * MIN_STEP_MICRODAYS);
    if (splittable.length === 0) break;
    const mids = splittable.map(({ a, b }) => a + ((b - a) >> 1));
    await samples.load(mids);
    const next: Interval[] = [];
    for (let i = 0; i < splittable.length; i++) {
      const { a, b } = splittable[i];
      const mid = mids[i];
      const rowA = samples.at(a);
      const rowB = samples.at(b);
      const bends =
        chordMissAu(rowA, samples.at(mid), rowB) > CHORD_TOLERANCE_AU ||
        hermiteBulgeAu(rowA, rowB) > CHORD_TOLERANCE_AU;
      if (!bends) continue;
      kept.add(mid);
      next.push({ a, b: mid }, { a: mid, b });
    }
    console.log(
      `    depth ${String(depth).padStart(2)}: ${String(splittable.length).padStart(5)} tested, ` +
        `${String(next.length / 2).padStart(5)} split`,
    );
    open = next;
  }
  return kept;
}

type Verification = {
  /** Worst miss, AU, across intervals refinement was free to subdivide. */
  worstAu: number;
  atJd: number;
  /** Intervals that reached the sampling floor and still miss by more than
   *  the tolerance — the SPK is discontinuous there and no grid can fix it. */
  floor: Array<{ jd: number; missAu: number }>;
};

/**
 * Measures the emitted track against the real trajectory at the midpoint of
 * every emitted interval — epochs the grid was never fitted to, so this is
 * an independent check of the file's accuracy claim rather than a
 * restatement of refinement's own stopping rule.
 *
 * Intervals sitting at the sampling floor are reported apart from the rest:
 * JPL splices its cruise and encounter solutions, and a spliced SPK steps
 * sideways by tens of thousands of km between one second and the next.
 * Bisection drives such an interval to the floor and still fails, which is
 * the honest outcome — averaging it into the tolerance would hide a real
 * discontinuity behind a number the rest of the grid does hold.
 */
async function verify(samples: SampleSet, emitted: VectorRow[]): Promise<Verification> {
  const mids = emitted.slice(0, -1).map((row, i) => {
    const a = microdaysOf(row[0]);
    return a + ((microdaysOf(emitted[i + 1][0]) - a) >> 1);
  });
  await samples.load(mids);
  const result: Verification = { worstAu: 0, atJd: 0, floor: [] };
  for (let i = 0; i < mids.length; i++) {
    const missAu = chordMissAu(emitted[i], samples.at(mids[i]), emitted[i + 1]);
    const atFloor = microdaysOf(emitted[i + 1][0]) - microdaysOf(emitted[i][0]) <= MIN_STEP_MICRODAYS;
    if (atFloor && missAu > CHORD_TOLERANCE_AU) {
      result.floor.push({ jd: jdOfMicrodays(mids[i]), missAu });
    } else if (missAu > result.worstAu) {
      result.worstAu = missAu;
      result.atJd = jdOfMicrodays(mids[i]);
    }
  }
  return result;
}

async function fetchProbe(probe: ProbeMission, retrievedUtc: string): Promise<void> {
  console.log(`  ${probe.label}`);
  const samples = new SampleSet(probe);
  const { startMu, stopMu } = await fetchSpanEndpoints(
    probe.horizonsId,
    probe.ephemerisStart,
    STOP_TIME,
  );

  // New Horizons' SPK ends exactly at STOP_TIME, and Horizons refuses a
  // TLIST epoch at an SPK's last instant while accepting a range that
  // stops there — so the grid ends one floor step inside it. The 88 s
  // given up lands in 2050, where the sampler coasts anyway.
  const endMu = stopMu - MIN_STEP_MICRODAYS;
  const base: number[] = [];
  for (let mu = startMu; mu < endMu; mu += BASE_STEP_MICRODAYS) base.push(mu);
  base.push(endMu);
  await samples.load(base);

  const kept = [...(await refine(samples, base))].sort((a, b) => a - b);
  const refined = kept.map((mu) => samples.at(mu));
  const emitted = decimateByChordError(refined, CHORD_TOLERANCE_AU);
  const { worstAu, atJd, floor } = await verify(samples, emitted);
  if (worstAu > VERIFY_LIMIT_AU) {
    throw new Error(
      `${probe.label}: emitted grid misses by ${worstAu.toExponential(2)} AU at JD ` +
        `${atJd.toFixed(4)}, over the ${VERIFY_LIMIT_AU.toExponential(2)} AU limit`,
    );
  }

  const header = samples.header!;
  const file: ProbeTrajectoryFile = {
    id: probe.id,
    label: probe.label,
    mission: probe.mission,
    horizonsId: probe.horizonsId,
    launchUtc: probe.launchUtc,
    launchUnixMs: unixMs(probe.launchUtc),
    lastContactUtc: probe.lastContactUtc,
    lastContactUnixMs: probe.lastContactUtc === null ? null : unixMs(probe.lastContactUtc),
    source: {
      frame: header.frame,
      center: header.centerBody,
      units: header.units,
      targetBody: header.targetBody,
      retrievedUtc,
    },
    chordToleranceAu: CHORD_TOLERANCE_AU,
    columns: [...PROBE_SAMPLE_COLUMNS],
    samples: emitted.map((row) => [
      Number(row[0].toFixed(JD_DECIMALS)),
      ...row.slice(1).map(round),
    ]),
  };

  writeFileSync(resolve(OUT_DIR, probeTrajectoryFilename(probe.id)), serializeRowFile(file));
  const spanDays = jdOfMicrodays(endMu - startMu);
  console.log(
    `    ${samples.requests} requests, ${samples.fetched} epochs fetched → ` +
      `${refined.length} refined → ${emitted.length} emitted ` +
      `(${(spanDays / emitted.length).toFixed(1)} d/sample mean, ` +
      `min gap ${(shortestGapDays(emitted) * 1440).toFixed(1)} min); ` +
      `worst measured miss ${worstAu.toExponential(2)} AU at JD ${atJd.toFixed(4)}`,
  );
  for (const { jd, missAu } of floor) {
    console.log(
      `    SPK discontinuity at JD ${jd.toFixed(4)}: ${missAu.toExponential(2)} AU ` +
        `across the ${(jdOfMicrodays(MIN_STEP_MICRODAYS) * 86400).toFixed(0)} s sampling floor`,
    );
  }
}

function shortestGapDays(rows: VectorRow[]): number {
  let gap = Infinity;
  for (let i = 1; i < rows.length; i++) gap = Math.min(gap, rows[i][0] - rows[i - 1][0]);
  return gap;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const retrievedUtc = new Date().toISOString();
  console.log(
    `Chord tolerance ${CHORD_TOLERANCE_AU} AU, base step ` +
      `${jdOfMicrodays(BASE_STEP_MICRODAYS).toFixed(3)} d, floor ` +
      `${(jdOfMicrodays(MIN_STEP_MICRODAYS) * 86400).toFixed(0)} s`,
  );
  const only = new Set(process.argv.slice(2));
  const roster = only.size === 0 ? PROBE_MISSIONS : PROBE_MISSIONS.filter((p) => only.has(p.id));
  if (roster.length === 0) throw new Error(`No roster probe matches ${[...only].join(', ')}`);
  for (const probe of roster) await fetchProbe(probe, retrievedUtc);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
