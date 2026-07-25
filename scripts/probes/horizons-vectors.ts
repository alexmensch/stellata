// Pure parser for a JPL Horizons VECTORS response (format=text,
// CSV_FORMAT=YES, VEC_TABLE=2). Drift guards: scripts/probes/README.md.

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
export const EXPECTED_CENTER_PREFIX = 'Sun (10)';

const HEADER_FIELDS: Array<[keyof HorizonsVectorsHeader, string]> = [
  ['targetBody', 'Target body name'],
  ['centerBody', 'Center body name'],
  ['units', 'Output units'],
  ['frame', 'Reference frame'],
];

function readHeaderField(text: string, label: string): string {
  const match = new RegExp(`^${label}\\s*:\\s*(.+)$`, 'm').exec(text);
  if (!match) throw new Error(`Horizons response has no "${label}" header line`);
  return match[1].trim().replace(/\s{2,}/g, ' ');
}

function parseHeader(text: string): HorizonsVectorsHeader {
  const header = {} as HorizonsVectorsHeader;
  for (const [key, label] of HEADER_FIELDS) header[key] = readHeaderField(text, label);

  if (header.units !== EXPECTED_UNITS) {
    throw new Error(`Horizons returned units "${header.units}", expected "${EXPECTED_UNITS}"`);
  }
  if (header.frame !== EXPECTED_FRAME) {
    throw new Error(`Horizons returned frame "${header.frame}", expected "${EXPECTED_FRAME}"`);
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

export function parseHorizonsVectors(text: string): HorizonsVectors {
  const start = text.indexOf('$$SOE');
  const end = text.indexOf('$$EOE');
  if (start < 0 || end < 0 || end < start) {
    const signature = text.slice(0, 400).replace(/\s+/g, ' ');
    throw new Error(`Horizons response has no $$SOE/$$EOE data block. Starts: ${signature}`);
  }

  const header = parseHeader(text.slice(0, start));
  const lines = text
    .slice(start + '$$SOE'.length, end)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error('Horizons data block is empty');

  const samples = lines.map(parseSampleRow);
  for (let i = 1; i < samples.length; i++) {
    if (samples[i][0] <= samples[i - 1][0]) {
      throw new Error(`Horizons jd column is not ascending at row ${i}: ${samples[i][0]}`);
    }
  }
  return { header, samples };
}
