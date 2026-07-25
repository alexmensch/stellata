// Fetches each roster probe's heliocentric state vectors from the JPL
// Horizons API and writes data/probes/{id}.json. Manual + infrequent
// (`pnpm run fetch:probes`); never part of `pnpm run build`.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';

import { parseHorizonsVectors } from './horizons-vectors';
import { PROBE_MISSIONS, type ProbeMission } from './probe-roster';
import { probeTrajectoryFilename } from './sync-probes-pure';
import {
  PROBE_SAMPLE_COLUMNS,
  type ProbeTrajectoryFile,
} from './probe-trajectory-schema';

const HORIZONS_API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const OUT_DIR = resolve(REPO_ROOT, 'data/probes');

/** Last epoch the JPL spacecraft SPKs cover; all five reach it. */
const STOP_TIME = '2050-01-01';
const STEP_SIZE = '30d';

/**
 * Significant digits kept per emitted number, down from Horizons' 16.
 * At 200 AU that is ~150 m of absolute position — invisible because the
 * probe-focal camera rides the same offset, and 4e-6 of a 30-day step so
 * the trail stays smooth. Trades ~30% of file size for nothing visible.
 */
const OUTPUT_PRECISION = 11;

function horizonsUrl(probe: ProbeMission): string {
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'${probe.horizonsId}'`,
    EPHEM_TYPE: 'VECTORS',
    CENTER: "'500@10'",
    REF_PLANE: 'FRAME',
    START_TIME: `'${probe.ephemerisStart}'`,
    STOP_TIME: `'${STOP_TIME}'`,
    STEP_SIZE: `'${STEP_SIZE}'`,
    VEC_TABLE: "'2'",
    OUT_UNITS: 'AU-D',
    CSV_FORMAT: "'YES'",
  });
  return `${HORIZONS_API}?${params}`;
}

function round(v: number): number {
  return Number(v.toPrecision(OUTPUT_PRECISION));
}

function unixMs(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`Unparseable roster date: ${iso}`);
  return ms;
}

/**
 * One array per sample on its own line: no repeated keys (the file is
 * thousands of rows) while a refresh still diffs sample-by-sample.
 */
function serialize(file: ProbeTrajectoryFile): string {
  const { samples, ...head } = file;
  const token = '__SAMPLES__';
  const scaffold = JSON.stringify({ ...head, samples: token }, null, 2);
  const rows = samples.map((row) => `    ${JSON.stringify(row)}`).join(',\n');
  return `${scaffold.replace(`"${token}"`, `[\n${rows}\n  ]`)}\n`;
}

async function fetchProbe(probe: ProbeMission, retrievedUtc: string): Promise<number> {
  const response = await fetch(horizonsUrl(probe));
  if (!response.ok) {
    throw new Error(`Horizons HTTP ${response.status} for ${probe.label}`);
  }
  const { header, samples } = parseHorizonsVectors(await response.text());

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
    columns: [...PROBE_SAMPLE_COLUMNS],
    samples: samples.map((row) => row.map(round)),
  };

  const path = resolve(OUT_DIR, probeTrajectoryFilename(probe.id));
  writeFileSync(path, serialize(file));
  return samples.length;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const retrievedUtc = new Date().toISOString();
  for (const probe of PROBE_MISSIONS) {
    const count = await fetchProbe(probe, retrievedUtc);
    console.log(`${probe.label}: ${count} samples → data/probes/${probe.id}.json`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
