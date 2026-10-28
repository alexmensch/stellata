// Gaia DR3 best-neighbour cross-walks (HIP, TYC) bridging classical catalog
// IDs onto gaia_source_id anchors. Many-to-one collisions keep the
// nearest match.
import type { Declared, SourceInput } from '../../util/sources/source';
import { tableLineReader, type TableRow } from '../../util/tsv/table-pure';

const GAIA_COL = 'gaia_source_id';
const ANG_COL = 'angular_distance';

/** `parseKey` returning null drops the row. */
interface BestNeighbourSpec<K> {
  readonly keyColumn: string;
  readonly parseKey: (raw: string) => K | null;
}

// HIP keys are positive integers; require pure-digit strings so a
// partial-numeric hip ("12abc") can't slip through and diverge from the
// Python parser (parity pinned in gaia-hip-xmatch-parity.test.ts).
const HIP_SPEC: BestNeighbourSpec<number> = {
  keyColumn: 'hip',
  parseKey: (raw) => {
    if (!/^\d+$/.test(raw)) return null;
    const hip = Number.parseInt(raw, 10);
    return hip > 0 ? hip : null;
  },
};

// Tycho ids stay opaque strings ("1000-1006-1") — parsers.py's
// parse_gaia_tyc_xmatch accepts any non-empty cell, and narrowing here
// would drop rows the binaries pipeline still resolves.
const TYC_SPEC: BestNeighbourSpec<string> = {
  keyColumn: 'tyc',
  parseKey: (raw) => (raw.length > 0 ? raw : null),
};

/** Line-fed accumulator so the whole-text parser and the streaming reader
 *  share one implementation. `keep`, when given, admits only those keys —
 *  the TYC table is 2.5 M rows read for a ~350 k-row join. */
function bestNeighbourAccumulator<K>(
  spec: BestNeighbourSpec<K>,
  from: Declared,
  keep?: ReadonlySet<K>,
) {
  const best = new Map<K, { ang: number; src: string }>();

  const fold = (row: TableRow<string>): void => {
    const keyRaw = row.raw(spec.keyColumn);
    const src = row.sourceId(GAIA_COL);
    if (!keyRaw || src === null || /^0+$/.test(src)) return;
    const key = spec.parseKey(keyRaw);
    if (key === null) return;
    if (keep && !keep.has(key)) return;
    const ang = row.float(ANG_COL) ?? Number.POSITIVE_INFINITY;
    const prev = best.get(key);
    if (!prev || ang < prev.ang) best.set(key, { ang, src });
  };

  const read = tableLineReader(
    { ...from, columns: [spec.keyColumn, GAIA_COL], optional: [ANG_COL] },
    fold,
  );

  return {
    line: read,
    result(): Map<K, string> {
      read.finish();
      const out = new Map<K, string>();
      for (const [key, { src }] of best) out.set(key, src);
      return out;
    },
  };
}

function parseBestNeighbourTsv<K>(
  text: string,
  spec: BestNeighbourSpec<K>,
  from: Declared,
  keep?: ReadonlySet<K>,
): Map<K, string> {
  const acc = bestNeighbourAccumulator(spec, from, keep);
  for (const line of text.split(/\r?\n/)) acc.line(line);
  return acc.result();
}

export function parseGaiaHipXmatchTsv(text: string, from: Declared): Map<number, string> {
  return parseBestNeighbourTsv(text, HIP_SPEC, from);
}

export function parseGaiaTycXmatchTsv(
  text: string,
  from: Declared,
  keep?: ReadonlySet<string>,
): Map<string, string> {
  return parseBestNeighbourTsv(text, TYC_SPEC, from, keep);
}

/** Streamed because gaia_dr3_tyc_xmatch.tsv is ~106 MB — reading it as one
 *  string peaks near a gigabyte alongside the join's own maps. */
export async function streamGaiaTycXmatch(
  input: SourceInput,
  keep?: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const acc = bestNeighbourAccumulator(TYC_SPEC, input, keep);
  await input.lines(acc.line);
  return acc.result();
}
