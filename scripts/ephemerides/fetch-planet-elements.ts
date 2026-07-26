// Fetches each planet's osculating elements from JPL Horizons onto a uniform
// grid, verifies the reconstruction off-grid, and writes
// data/ephemerides/{id}.json. See README.md § Cadence.

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import { roundSignificant, serializeRowFile } from '../util/frozen-json';
import { fetchHorizonsText, rangeChunks } from '../util/horizons-response';
import {
  EXPECTED_FRAME_ECLIPTIC,
  parseHorizonsVectors,
} from '../probes/horizons-vectors';
import { orbitalStateToCartesian } from '../../src/client/util/kepler-solver';
import {
  buildElementTable,
  elementTableSampleAt,
} from '../../src/client/solar-system/ephemerides/element-table';
import {
  equinoctialFromAngles,
  equinoctialToClassical,
  makeClassical,
  makeEquinoctial,
} from '../../src/client/solar-system/ephemerides/equinoctial-pure';

import { parseHorizonsElements, type ElementRow } from './horizons-elements';
import { unwrapMeanLongitude } from './element-unwrap-pure';
import {
  ELEMENT_TARGETS,
  POSITION_TOLERANCE_AU,
  tableEpochs,
  type PlanetElementTarget,
} from './planet-element-roster';
import {
  ELEMENT_COLUMNS,
  type PlanetElementTableFile,
} from './planet-element-schema';

const OUT_DIR = resolve(REPO_ROOT, 'data/ephemerides');

/** Significant digits kept per emitted element, down from Horizons' 16. The
 *  binding column is the unwrapped mean longitude: it reaches ~3e5 degrees at
 *  Mercury and the 1e-5 AU bound needs it to ~1e-4 degrees, so 11 digits
 *  leaves three orders of headroom on the tightest column. */
const OUTPUT_PRECISION = 11;

/** A returned epoch further than this from the requested grid epoch means
 *  Horizons re-stepped the range and rows can no longer be matched by
 *  position. One microday is the finest a `JD…` string resolves. */
const EPOCH_DRIFT_TOLERANCE_D = 1e-6;

function elementsParams(target: PlanetElementTarget, startJd: number, stopJd: number, intervals: number): URLSearchParams {
  return new URLSearchParams({
    format: 'text',
    COMMAND: `'${target.horizonsId}'`,
    EPHEM_TYPE: 'ELEMENTS',
    CENTER: "'500@10'",
    REF_PLANE: 'ECLIPTIC',
    OUT_UNITS: 'AU-D',
    CSV_FORMAT: "'YES'",
    START_TIME: `'JD${startJd.toFixed(6)}'`,
    STOP_TIME: `'JD${stopJd.toFixed(6)}'`,
    STEP_SIZE: `'${intervals}'`,
  });
}

function vectorsParams(target: PlanetElementTarget, startJd: number, stopJd: number, intervals: number): URLSearchParams {
  const params = elementsParams(target, startJd, stopJd, intervals);
  params.set('EPHEM_TYPE', 'VECTORS');
  params.set('VEC_TABLE', "'2'");
  return params;
}

/** Rows for exactly `epochs`, fetched as the fewest range queries the API's
 *  row cap allows. Chunk endpoints land on grid epochs, so no chunk boundary
 *  can shift the cadence. */
async function fetchOnGrid<T>(
  epochs: readonly number[],
  request: (startJd: number, stopJd: number, intervals: number) => Promise<Array<{ jd: number } & T>>,
): Promise<Array<{ jd: number } & T>> {
  const rows: Array<{ jd: number } & T> = [];
  for (const { first, last } of rangeChunks(epochs.length)) {
    const chunk = await request(epochs[first], epochs[last], last - first);
    if (chunk.length !== last - first + 1) {
      throw new Error(`Horizons returned ${chunk.length} rows for ${last - first + 1} epochs`);
    }
    chunk.forEach((row, i) => {
      const drift = Math.abs(row.jd - epochs[first + i]);
      if (drift > EPOCH_DRIFT_TOLERANCE_D) {
        throw new Error(`Horizons row ${first + i} is at JD ${row.jd}, ${drift} d off the grid`);
      }
    });
    rows.push(...chunk);
  }
  return rows;
}

async function fetchElementRows(
  target: PlanetElementTarget,
  epochs: readonly number[],
): Promise<{ header: ReturnType<typeof parseHorizonsElements>['header']; rows: ElementRow[] }> {
  let header: ReturnType<typeof parseHorizonsElements>['header'] | null = null;
  const rows = await fetchOnGrid<Omit<ElementRow, 'jd'>>(epochs, async (startJd, stopJd, intervals) => {
    const parsed = parseHorizonsElements(
      await fetchHorizonsText(elementsParams(target, startJd, stopJd, intervals)),
    );
    header = parsed.header;
    return parsed.rows;
  });
  if (header === null) throw new Error(`No Horizons response for ${target.id}`);
  return { header, rows };
}

async function fetchTruthPositions(
  target: PlanetElementTarget,
  epochs: readonly number[],
): Promise<Array<{ jd: number; x: number; y: number; z: number }>> {
  return fetchOnGrid<{ x: number; y: number; z: number }>(epochs, async (startJd, stopJd, intervals) => {
    const { samples } = parseHorizonsVectors(
      await fetchHorizonsText(vectorsParams(target, startJd, stopJd, intervals)),
      EXPECTED_FRAME_ECLIPTIC,
    );
    return samples.map(([jd, x, y, z]) => ({ jd, x, y, z }));
  });
}

/** Wire rows: Horizons' (Ω, ω, M) folded into the equinoctial pairs, with the
 *  mean longitude λ = M + Ω + ω unwrapped across the whole table. */
function buildSamples(rows: readonly ElementRow[], stepDays: number): number[][] {
  const longperi = rows.map((r) => r.longnodeDeg + r.argperiDeg);
  const lambda = unwrapMeanLongitude(
    rows.map((r, i) => r.mDeg + longperi[i]),
    rows.map((r) => r.nDegPerDay),
    stepDays,
  );
  const eq = makeEquinoctial();
  return rows.map((r, i) => {
    equinoctialFromAngles(r.aAu, r.e, r.iDeg, r.longnodeDeg, longperi[i], lambda[i], eq);
    return [eq.aAu, eq.h, eq.k, eq.p, eq.q, eq.lambdaDeg].map((v) =>
      roundSignificant(v, OUTPUT_PRECISION),
    );
  });
}

/** Largest distance between a position reconstructed from the emitted table
 *  and Horizons' own, over the epochs given. Run at interval midpoints — the
 *  worst case for a linear interpolation, and epochs the table was never
 *  fitted to — and again on the grid, where what remains is the emitted
 *  rounding plus the element-to-Cartesian round trip. */
function reconstructionErrorAu(
  file: PlanetElementTableFile,
  truth: ReadonlyArray<{ jd: number; x: number; y: number; z: number }>,
): number {
  const table = buildElementTable(file);
  const eq = makeEquinoctial();
  const classical = makeClassical();
  const pos = { x: 0, y: 0, z: 0 };
  let worst = 0;
  for (const t of truth) {
    if (!elementTableSampleAt(table, t.jd, eq)) {
      throw new Error(`${file.id}: verification epoch JD ${t.jd} is outside the emitted table`);
    }
    equinoctialToClassical(eq, classical);
    orbitalStateToCartesian(
      classical.aAu, classical.e, classical.incRad,
      classical.nodeRad, classical.argPeriRad, classical.mRad, pos,
    );
    worst = Math.max(worst, Math.hypot(pos.x - t.x, pos.y - t.y, pos.z - t.z));
  }
  return worst;
}

async function buildTarget(target: PlanetElementTarget): Promise<boolean> {
  const epochs = tableEpochs(target.stepDays);
  const { header, rows } = await fetchElementRows(target, epochs);
  const file: PlanetElementTableFile = {
    id: target.id,
    horizonsId: target.horizonsId,
    jd0: epochs[0],
    stepDays: target.stepDays,
    source: {
      frame: header.frame,
      center: header.centerBody,
      units: header.units,
      outputType: header.outputType,
      targetBody: header.targetBody,
      retrievedUtc: new Date().toISOString(),
    },
    positionToleranceAu: POSITION_TOLERANCE_AU,
    columns: ELEMENT_COLUMNS,
    samples: buildSamples(rows, target.stepDays),
  };

  const midpoints = epochs.slice(0, -1).map((jd) => jd + target.stepDays / 2);
  const onGrid = reconstructionErrorAu(file, await fetchTruthPositions(target, epochs));
  const offGrid = reconstructionErrorAu(file, await fetchTruthPositions(target, midpoints));

  const path = resolve(OUT_DIR, `${target.id}.json`);
  writeFileSync(path, serializeRowFile(file));
  const kb = Math.round(statSync(path).size / 1024);
  const holds = offGrid <= POSITION_TOLERANCE_AU;
  console.log(
    `${target.id.padEnd(8)} ${String(target.stepDays).padStart(3)} d  ` +
    `${String(file.samples.length).padStart(5)} rows  ${String(kb).padStart(4)} KB  ` +
    `on-grid ${onGrid.toExponential(2)}  midpoint ${offGrid.toExponential(2)} AU  ` +
    `${holds ? 'holds' : 'OVER BUDGET'}`,
  );
  return holds;
}

const only = new Set(process.argv.slice(2));
const targets = only.size === 0
  ? ELEMENT_TARGETS
  : ELEMENT_TARGETS.filter((t) => only.has(t.id));
if (targets.length === 0) throw new Error(`No such planet: ${[...only].join(', ')}`);

mkdirSync(OUT_DIR, { recursive: true });
let allHold = true;
for (const target of targets) {
  allHold = (await buildTarget(target)) && allHold;
}
if (!allHold) {
  console.error(`\nSome tables exceed ${POSITION_TOLERANCE_AU} AU — tighten their stepDays.`);
  process.exitCode = 1;
}
