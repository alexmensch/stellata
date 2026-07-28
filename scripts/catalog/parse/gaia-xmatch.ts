// Gaia DR3 best-neighbour cross-walks (HIP, TYC) bridging classical catalog
// IDs onto gaia_source_id anchors. Many-to-one collisions keep the
// nearest match.
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const GAIA_COL = 'gaia_source_id';
const ANG_COL = 'angular_distance';

/** One best-neighbour table's key column and how its raw cell parses.
 *  `parseKey` returning null drops the row. */
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
  keep?: ReadonlySet<K>,
) {
  let keyIdx = -1;
  let gaiaIdx = -1;
  let angIdx = -1;
  const best = new Map<K, { ang: number; src: string }>();

  return {
    line(line: string): void {
      if (!line) return;
      const fields = line.split('\t');
      if (keyIdx < 0) {
        keyIdx = fields.indexOf(spec.keyColumn);
        gaiaIdx = fields.indexOf(GAIA_COL);
        angIdx = fields.indexOf(ANG_COL);
        if (keyIdx < 0 || gaiaIdx < 0) {
          throw new Error(
            `gaia xmatch: expected columns ${spec.keyColumn} + ${GAIA_COL} in header`,
          );
        }
        return;
      }
      const keyRaw = fields[keyIdx];
      const gaiaRaw = fields[gaiaIdx];
      if (!keyRaw || !gaiaRaw) return;
      const key = spec.parseKey(keyRaw);
      if (key === null) return;
      if (keep && !keep.has(key)) return;
      if (!/^\d+$/.test(gaiaRaw) || /^0+$/.test(gaiaRaw)) return;
      let ang = Number.POSITIVE_INFINITY;
      if (angIdx >= 0 && fields[angIdx]) {
        const parsed = Number.parseFloat(fields[angIdx]);
        if (Number.isFinite(parsed)) ang = parsed;
      }
      const prev = best.get(key);
      if (!prev || ang < prev.ang) best.set(key, { ang, src: gaiaRaw });
    },
    result(): Map<K, string> {
      // A file that never yielded a header is a truncated or unsmudged LFS
      // input, not an empty cross-walk. Returning an empty map instead would
      // silently zero every backfill this table feeds.
      if (keyIdx < 0) {
        throw new Error(
          `gaia xmatch: no header row — expected columns ${spec.keyColumn} + ${GAIA_COL}`,
        );
      }
      const out = new Map<K, string>();
      for (const [key, { src }] of best) out.set(key, src);
      return out;
    },
  };
}

function parseBestNeighbourTsv<K>(
  text: string,
  spec: BestNeighbourSpec<K>,
  keep?: ReadonlySet<K>,
): Map<K, string> {
  const acc = bestNeighbourAccumulator(spec, keep);
  for (const line of text.split(/\r?\n/)) acc.line(line);
  return acc.result();
}

async function readBestNeighbourStreamed<K>(
  path: string,
  spec: BestNeighbourSpec<K>,
  keep?: ReadonlySet<K>,
): Promise<Map<K, string>> {
  const acc = bestNeighbourAccumulator(spec, keep);
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) acc.line(line);
  return acc.result();
}

export function parseGaiaHipXmatchTsv(text: string): Map<number, string> {
  return parseBestNeighbourTsv(text, HIP_SPEC);
}

export function readGaiaHipXmatch(path: string): Map<number, string> {
  return parseBestNeighbourTsv(readFileSync(path, 'utf8'), HIP_SPEC);
}

export function parseGaiaTycXmatchTsv(
  text: string,
  keep?: ReadonlySet<string>,
): Map<string, string> {
  return parseBestNeighbourTsv(text, TYC_SPEC, keep);
}

/** Streamed because gaia_dr3_tyc_xmatch.tsv is ~106 MB — reading it as one
 *  string peaks near a gigabyte alongside the join's own maps. */
export function readGaiaTycXmatch(
  path: string,
  keep?: ReadonlySet<string>,
): Promise<Map<string, string>> {
  return readBestNeighbourStreamed(path, TYC_SPEC, keep);
}
