// Pure parser for a JPL Horizons VECTORS response (format=text,
// CSV_FORMAT=YES, VEC_TABLE=2). Drift guards: scripts/probes/README.md.

import {
  assertAscendingJd,
  readHeaderField,
  splitDataBlock,
} from '../util/horizons-response';

import { PROBE_SAMPLE_STRIDE } from './probe-trajectory-schema';

export type HorizonsVectorsHeader = {
  targetBody: string;
  centerBody: string;
  units: string;
  frame: string;
};

export type HorizonsVectors = {
  header: HorizonsVectorsHeader;
  /** [jd, x, y, z, vx, vy, vz] per row, ascending in jd. */
  samples: number[][];
};

export const EXPECTED_UNITS = 'AU-D';
export const EXPECTED_FRAME = 'ICRF';
/** `REF_PLANE=ECLIPTIC` reports this instead — the frame the planet element
 *  tables and their verification vectors are fetched in. */
export const EXPECTED_FRAME_ECLIPTIC = 'Ecliptic of J2000.0';
export const EXPECTED_CENTER_PREFIX = 'Sun (10)';

const HEADER_FIELDS: Array<[keyof HorizonsVectorsHeader, string]> = [
  ['targetBody', 'Target body name'],
  ['centerBody', 'Center body name'],
  ['units', 'Output units'],
  ['frame', 'Reference frame'],
];

function parseHeader(text: string, expectedFrame: string): HorizonsVectorsHeader {
  const header = {} as HorizonsVectorsHeader;
  for (const [key, label] of HEADER_FIELDS) header[key] = readHeaderField(text, label);

  if (header.units !== EXPECTED_UNITS) {
    throw new Error(`Horizons returned units "${header.units}", expected "${EXPECTED_UNITS}"`);
  }
  if (header.frame !== expectedFrame) {
    throw new Error(`Horizons returned frame "${header.frame}", expected "${expectedFrame}"`);
  }
  if (!header.centerBody.startsWith(EXPECTED_CENTER_PREFIX)) {
    throw new Error(
      `Horizons centred on "${header.centerBody}", expected "${EXPECTED_CENTER_PREFIX}"`,
    );
  }
  return header;
}

function parseSampleRow(line: string, lineNo: number): number[] {
  // JDTDB, calendar date, X, Y, Z, VX, VY, VZ — the calendar column is a
  // redundant restatement of JDTDB and is dropped.
  const cells = line.split(',').map((c) => c.trim());
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  if (cells.length !== PROBE_SAMPLE_STRIDE + 1) {
    throw new Error(
      `Horizons row ${lineNo} has ${cells.length} columns, expected ${PROBE_SAMPLE_STRIDE + 1}`,
    );
  }
  const numeric = [cells[0], ...cells.slice(2)].map(Number);
  const bad = numeric.findIndex((v) => !Number.isFinite(v));
  if (bad >= 0) throw new Error(`Horizons row ${lineNo} has non-finite column ${bad}: ${line}`);
  return numeric;
}

export function parseHorizonsVectors(
  text: string,
  expectedFrame: string = EXPECTED_FRAME,
): HorizonsVectors {
  const { headerText, lines } = splitDataBlock(text);
  const header = parseHeader(headerText, expectedFrame);
  const samples = lines.map(parseSampleRow);
  assertAscendingJd(samples.map((s) => s[0]));
  return { header, samples };
}
