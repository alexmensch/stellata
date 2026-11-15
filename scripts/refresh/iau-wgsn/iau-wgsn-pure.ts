// The IAU WGSN pull's two files: where each is fetched from and the gates its text must pass before it is committed verbatim. See README.md.

import { parse } from 'csv-parse/sync';

import { FAINTS_HEADER, NEC_HEADER, NULL_SPELLINGS } from '../../catalog/naming/wgsn-parse-pure';
import type { Check, PullDescription } from '../../util/emit-artifacts';
import { bandCheck, spotRowCheck, type RowBand, type SpotRow } from '../pull/gates-pure';
import { TapRefused, TapTransient } from '../pull/tap-pure';

export interface WgsnFile {
  readonly url: string;
  readonly header: string;
  readonly band: RowBand;
  /** The fewest rows whose `Name` is not a null spelling. */
  readonly minNamed: number;
  readonly spotRows: readonly [SpotRow, ...SpotRow[]];
}

const UPLOADS = 'https://exopla.net/wp-content/uploads/2025/05';

export const WGSN_FILES = {
  nec: {
    url: `${UPLOADS}/NEC.csv`,
    header: NEC_HEADER,
    /** The naked-eye sky is a closed set: a re-release may correct rows but not grow past V ≤ 6.5. */
    band: { min: 9_000, max: 10_500 },
    minNamed: 370,
    spotRows: [
      { key: 'NEC', value: '5', cells: { HIP: 'HIP 88', 'Bayer/other': 'τ Phoenicis' } },
      { key: 'NEC', value: '8', cells: { 'Bayer/other': 'θ Octantis', HD: '224889' } },
    ],
  },
  faints: {
    url: `${UPLOADS}/wgsnFaints.csv`,
    header: FAINTS_HEADER,
    band: { min: 120, max: 400 },
    minNamed: 120,
    spotRows: [{ key: 'WGSN-ID', value: '10001', cells: { Name: 'Citadelle', HIP: 'HIP 1547' } }],
  },
} as const satisfies Readonly<Record<string, WgsnFile>>;

export type WgsnKey = keyof typeof WGSN_FILES;

const host = (url: string): string => new URL(url).host;

/** The URLs are the whole query: plain HTTP, no TAP. */
export function describeWgsn(): PullDescription {
  const urls = Object.values(WGSN_FILES).map((f) => f.url);
  return { query: urls.join('\n'), services: [...new Set(urls.map(host))].sort() };
}

export const wgsnService = (key: WgsnKey): string => host(WGSN_FILES[key].url);

/** A 200's body as UTF-8, a byte-order mark dropped; a 5xx is transient, any other status refused. */
export function fetchedText(url: string, status: number, body: ArrayBuffer): string {
  if (status >= 500) throw new TapTransient(`${url}: HTTP ${status}`);
  if (status !== 200) throw new TapRefused(`${url}: HTTP ${status}`);
  return new TextDecoder('utf-8').decode(body);
}

/** Every gate on one file's text, each cell read trimmed and an empty one as null. */
export function wgsnChecks(key: WgsnKey, text: string): Check[] {
  const file: WgsnFile = WGSN_FILES[key];
  const header = text.split(/\r?\n/, 1)[0];
  if (header !== file.header) {
    return [{
      kind: 'fail',
      message: `${key}: upstream header changed.\n  expected: ${file.header}\n  got:      ${header}\nReview the upstream release before refreshing the frozen slice.`,
    }];
  }
  const rows = parse(text, { columns: true }) as Array<Record<string, string>>;
  const cells = rows.map((row) => (column: string): string | null => {
    const cell = (row[column] ?? '').trim();
    return cell === '' ? null : cell;
  });
  const named = rows.filter((row) => !NULL_SPELLINGS.has((row.Name ?? '').trim())).length;
  const namedReport = `${key}: ${named} named rows, at least ${file.minNamed}`;
  return [
    bandCheck(key, rows.length, file.band),
    named >= file.minNamed ? { kind: 'pass', report: namedReport } : { kind: 'fail', message: `${namedReport}: too few` },
    spotRowCheck(key, cells, file.spotRows),
  ];
}
