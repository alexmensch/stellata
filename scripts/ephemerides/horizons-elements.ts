// Pure parser for a JPL Horizons ELEMENTS response (format=text,
// CSV_FORMAT=YES). Sibling of scripts/probes/horizons-vectors.ts and carries
// the same drift guards; see README.md § Header pins.

import {
  assertAscendingJd,
  readHeaderField,
  splitDataBlock,
} from '../util/horizons-response';

export type HorizonsElementsHeader = {
  targetBody: string;
  centerBody: string;
  units: string;
  frame: string;
  outputType: string;
};

/** One osculating-element row, in the units the header pins. */
export type ElementRow = {
  /** Julian Date, TDB. */
  jd: number;
  aAu: number;
  e: number;
  iDeg: number;
  longnodeDeg: number;
  argperiDeg: number;
  /** Mean anomaly, degrees, as Horizons reports it — folded into [0, 360). */
  mDeg: number;
  /** Mean motion, degrees per day. Not emitted; it is what makes the
   *  revolution count between two samples unambiguous when unwrapping `m`. */
  nDegPerDay: number;
};

export type HorizonsElements = {
  header: HorizonsElementsHeader;
  /** Ascending in `jd`. */
  rows: ElementRow[];
};

export const EXPECTED_UNITS_PREFIX = 'AU-D';
export const EXPECTED_FRAME = 'Ecliptic of J2000.0';
export const EXPECTED_CENTER_PREFIX = 'Sun (10)';
export const EXPECTED_OUTPUT_TYPE = 'GEOMETRIC osculating elements';

/** Column layout of the CSV block: JDTDB, calendar date, then the twelve
 *  element columns Horizons emits for `EPHEM_TYPE=ELEMENTS`. The calendar
 *  column restates JDTDB and is dropped; QR/Tp/TA/AD/PR are derivable from
 *  the six Keplerian elements and are dropped too. */
const COLUMN_INDEX = {
  jd: 0, ec: 2, in: 4, om: 5, w: 6, n: 8, ma: 9, a: 11,
} as const;

const EXPECTED_COLUMNS = 14;

const HEADER_FIELDS: Array<[keyof HorizonsElementsHeader, string]> = [
  ['targetBody', 'Target body name'],
  ['centerBody', 'Center body name'],
  ['units', 'Output units'],
  ['outputType', 'Output type'],
  ['frame', 'Reference frame'],
];

function parseHeader(text: string): HorizonsElementsHeader {
  const header = {} as HorizonsElementsHeader;
  for (const [key, label] of HEADER_FIELDS) header[key] = readHeaderField(text, label);

  if (!header.units.startsWith(EXPECTED_UNITS_PREFIX)) {
    throw new Error(`Horizons returned units "${header.units}", expected "${EXPECTED_UNITS_PREFIX}…"`);
  }
  if (header.frame !== EXPECTED_FRAME) {
    throw new Error(`Horizons returned frame "${header.frame}", expected "${EXPECTED_FRAME}"`);
  }
  if (!header.centerBody.startsWith(EXPECTED_CENTER_PREFIX)) {
    throw new Error(
      `Horizons centred on "${header.centerBody}", expected "${EXPECTED_CENTER_PREFIX}"`,
    );
  }
  if (header.outputType !== EXPECTED_OUTPUT_TYPE) {
    throw new Error(
      `Horizons returned output type "${header.outputType}", expected "${EXPECTED_OUTPUT_TYPE}"`,
    );
  }
  return header;
}

function parseRow(line: string, lineNo: number): ElementRow {
  const cells = line.split(',').map((c) => c.trim());
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  if (cells.length !== EXPECTED_COLUMNS) {
    throw new Error(
      `Horizons row ${lineNo} has ${cells.length} columns, expected ${EXPECTED_COLUMNS}`,
    );
  }
  const row: ElementRow = {
    jd: Number(cells[COLUMN_INDEX.jd]),
    aAu: Number(cells[COLUMN_INDEX.a]),
    e: Number(cells[COLUMN_INDEX.ec]),
    iDeg: Number(cells[COLUMN_INDEX.in]),
    longnodeDeg: Number(cells[COLUMN_INDEX.om]),
    argperiDeg: Number(cells[COLUMN_INDEX.w]),
    mDeg: Number(cells[COLUMN_INDEX.ma]),
    nDegPerDay: Number(cells[COLUMN_INDEX.n]),
  };
  for (const [key, value] of Object.entries(row)) {
    if (!Number.isFinite(value)) {
      throw new Error(`Horizons row ${lineNo} has non-finite ${key}: ${line}`);
    }
  }
  if (row.aAu <= 0 || row.e < 0 || row.e >= 1 || row.nDegPerDay <= 0) {
    throw new Error(`Horizons row ${lineNo} is not a bound elliptical orbit: ${line}`);
  }
  return row;
}

export function parseHorizonsElements(text: string): HorizonsElements {
  const { headerText, lines } = splitDataBlock(text);
  const header = parseHeader(headerText);
  const rows = lines.map(parseRow);
  assertAscendingJd(rows.map((r) => r.jd));
  return { header, rows };
}
