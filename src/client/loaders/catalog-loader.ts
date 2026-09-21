import {
  readCatalogHeader,
  readNameTable,
  recordsOffset,
  catalogChunkOffset,
  wholeRecordSpan,
  type CatalogManifest,
  type RecordSpan,
} from '../../../scripts/catalog/record/catalog-pure';
import { chunkRecordSpan, startChunkFetches } from './catalog-progressive';
import { createCatalogDecoder, decodeInline } from './catalog-decode-host';
import {
  CATALOG_WINDOW_COLUMNS,
  allocateCatalogColumns,
  copyWindowColumn,
  type CatalogWindow,
} from './catalog-window';

export interface Constellation {
  code: string;
  name: string;
  // Classical stick-figure polylines, each a list of star indices into the
  // catalog record array. Populated by the build step from Stellarium's
  // modern sky culture; absent for constellations with no asterism lines.
  lines?: number[][];
}

export interface Catalog {
  /** Every record the artifact holds. Array lengths are fixed against this
   *  from the first chunk, so nothing downstream reallocates as the tail
   *  arrives. */
  count: number;
  /** Records decoded so far — a prefix of `count`, growing as transport
   *  chunks land. Anything walking the catalogue during load bounds itself
   *  here; past it the arrays hold zeros, and a zero position is Sol's own.
   *  ./README.md § Progressive catalog load. */
  loadedCount: number;
  positions: Float32Array;       // length = count * 3
  // Space-motion velocity, equatorial Cartesian pc/yr (Sol at origin).
  // length = count * 3. Consumed once at load by the epoch-advance pass
  // (epoch-advance-pure.ts) to propagate `positions` off the fixed J2016.0
  // baseline to getT(); positions ship at J2016.0 on the wire.
  velocities: Float32Array;      // length = count * 3
  absmag: Float32Array;          // length = count
  ci: Float32Array;              // length = count
  spectClass: Float32Array;      // length = count (as float for vertex attrib)
  luminosityClass: Uint8Array;   // length = count, 255 = unknown
  physicalRadius: Float32Array;  // length = count, in solar radii
  constellation: Float32Array;   // length = count (as float for vertex attrib)
  // bit 0 has_name, 1 is_sol, 2 has_bayer, 4 is_binary_primary.
  // is_binary_primary is set on at most one component per system —
  // the brighter member of a mutual geometric pair, or the brightest
  // catalog component of a CCDM-grouped Hipparcos double — so each
  // binary system gets exactly one chart-mode wings glyph.
  flags: Uint8Array;             // length = count
  companion: Int32Array;         // length = count, -1 = no companion
  periodDays: Float32Array;      // length = count, 0 = not variable
  amplitudeMag: Float32Array;    // length = count, 0 = not variable
  // Per-star GCVS variability class. 0=unknown/non-variable,
  // 1=pulsating, 2=eclipsing, 3=other (cataclysmic, eruptive,
  // rotating, …); 4+ refine pulsating into families (Mira/semiregular/
  // Cepheid/RR Lyr/DSCT-class). Gates the runtime pulsation-suppress for
  // eclipsing binaries with orbital elements and keys the per-type
  // pulsation table below.
  varType: Uint8Array;           // length = count
  // Per-star pulsation params derived from varType at load
  // (buildPulsationParams). pulsRho = peak-to-peak physical-radius ratio;
  // pulsColorSwing = peak-to-peak B−V swing. Consumed by the star shader
  // (iPulsRho/iPulsColorSwing) and the CPU disc mirror (renderedSizePx /
  // peakAmplitudeFactor). Inert on non-variables — the shader gates
  // radius modulation on period/amplitude/suppress.
  pulsRho: Float32Array;         // length = count
  pulsColorSwing: Float32Array;  // length = count
  hip: Uint32Array;              // length = count, 0 = no HIP
  // Frozen Stellata ID per record (docs/sid.md § 7). 0 = NO_SID, which
  // never ships (the build hard-fails on unallocated records) but is
  // still guarded at consumers so a hand-built artifact degrades.
  sid: Uint32Array;              // length = count
  // Gaia DR3 source_id per record; 0n sentinel = no Gaia DR3 source_id.
  // Stored as BigUint64Array because IDs routinely exceed 2^53 and would
  // truncate as plain Numbers. Convert with `String(arr[i])` at query time.
  gaiaSourceId: BigUint64Array;  // length = count
  // Per-record multiplicity: 0 = single, 1 = resolved (a multiples.tsv
  // member row backs the record), 2 = unresolved (SIMBAD otype '**',
  // nothing resolved — spectroscopic binaries). MULTIPLICITY_* constants.
  multiplicityStatus: Uint8Array; // length = count
  // Gaia DR3 Apsis astrophysical parameters per record. NaN (NO_APSIS) =
  // absent; consumers test with `Number.isNaN(arr[i])`. gspphot and
  // gspspec are independent Gaia solutions, either or both may be absent.
  teffGspphot: Float32Array;     // length = count, Kelvin
  loggGspphot: Float32Array;     // length = count, log cgs
  mhGspphot: Float32Array;       // length = count, [M/H] dex
  azeroGspphot: Float32Array;    // length = count, mag (line-of-sight extinction)
  teffGspspec: Float32Array;     // length = count, Kelvin
  loggGspspec: Float32Array;     // length = count, log cgs
  mhGspspec: Float32Array;       // length = count, [M/H] dex
  names: Map<number, string>;    // star index -> proper name (named stars only)
  solIndex: number;              // -1 if not found
  constellations: Constellation[];
  // Retired sid → successor sid, from the manifest's sidSuccessors field
  // (docs/sid.md § 9.4). Empty until a merge-type retirement ships. Fed to
  // the SID resolver so retired wire sids resolve to their successor.
  sidSuccessors: ReadonlyMap<number, number>;
  /** Called after each chunk's records decode, with the window that just
   *  landed. Returns its own unsubscribe. */
  onRecordsDecoded(listener: (span: DecodedSpan) => void): () => void;
  /** Settles when `loadedCount === count`. Rejects if any chunk fails, so a
   *  caller awaiting the full catalogue sees the same error boot would. */
  readonly whenComplete: Promise<void>;
}

/** The half-open record window one chunk's decode filled. */
export interface DecodedSpan {
  first: number;
  end: number;
}

export interface LoadProgress {
  bytes: number;
  total: number;
}

/** Resolves once the FIRST transport chunk has decoded, with the rest still
 *  in flight — boot paints off the returned prefix and the catalogue fills
 *  behind it (`./README.md` § Progressive catalog load). Await
 *  `catalog.whenComplete` for the whole population. */
export async function loadCatalog(
  manifestUrl: string,
  conUrl: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<Catalog> {
  const [manifest, constellations] = await Promise.all([
    fetchManifest(manifestUrl),
    fetch(conUrl).then((r) => r.json() as Promise<Constellation[]>),
  ]);

  // Chunk URLs are siblings of the manifest — same directory prefix, name
  // from the shared `catalogChunkFilename` so client + writer agree.
  const dirUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  const assembled = new Uint8Array(manifest.totalBytes);
  let loaded = 0;
  const report = onProgress
    ? (delta: number) => {
      loaded += delta;
      onProgress({ bytes: loaded, total: manifest.totalBytes });
    }
    : undefined;
  const fetches = startChunkFetches({ dirUrl, manifest, into: assembled, onBytes: report });

  await fetches[0];
  // The name table precedes the records and is read whole, once, so the
  // chunks covering it have to be in before the catalogue is built — a
  // half-landed table reads its tail as zeros and silently loses those
  // names. Chunk 0 carries the 32-byte header in every plan.
  const base = recordsOffset(readCatalogHeader(assembled.buffer));
  let next = 1;
  while (
    next < fetches.length
    && catalogChunkOffset(manifest.chunkBytes, next) < base
  ) {
    await fetches[next];
    next++;
  }
  const catalog = beginCatalog(assembled.buffer, constellations, manifest);
  const absorbWith = async (
    index: number,
    decode: (source: ArrayBuffer, span: RecordSpan) => CatalogWindow | Promise<CatalogWindow>,
  ): Promise<void> => {
    const span = catalog.chunkSpan(index);
    if (span) catalog.absorb(await decode(assembled.buffer, span));
  };
  // On to the first chunk carrying a whole record — with a small first
  // chunk that is not chunk 0, and boot needs a star to paint. Inline:
  // ./README.md § The catalog-decode worker, the pre-paint windows.
  for (let i = 0; i < next; i++) await absorbWith(i, decodeInline);
  while (catalog.loadedCount === 0 && next < fetches.length) {
    await fetches[next];
    await absorbWith(next, decodeInline);
    next++;
  }
  const from = next;
  catalog.settleOn((async () => {
    const decoder = createCatalogDecoder();
    try {
      for (let i = from; i < fetches.length; i++) {
        await fetches[i];
        await absorbWith(i, (source, span) => decoder.decode(source, span));
      }
    } finally {
      decoder.dispose();
    }
  })());
  return catalog;
}

async function fetchManifest(manifestUrl: string): Promise<CatalogManifest> {
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`Failed to load ${manifestUrl}: ${res.status}`);
  return (await res.json()) as CatalogManifest;
}

/** A fully-decoded catalogue from one assembled buffer — the Node readers
 *  and every test that has all the bytes already. Boot goes through
 *  `loadCatalog` instead, which decodes chunk by chunk. */
export function parseBinary(
  ab: ArrayBuffer,
  constellations: Constellation[],
  sidSuccessorPairs: readonly [number, number][] = [],
): Catalog {
  const catalog = beginCatalog(ab, constellations, { sidSuccessors: sidSuccessorPairs });
  catalog.absorb(decodeInline(ab, wholeRecordSpan(readCatalogHeader(ab))));
  catalog.settleOn(Promise.resolve());
  return catalog;
}

interface GrowingCatalog extends Catalog {
  /** Land a decoded window and announce it. Windows arrive in record order,
   *  each starting where the last ended. */
  absorb(window: CatalogWindow): void;
  /** The record window the given chunk index completes, or null where it
   *  completes none — true of a chunk 0 that is all header and name table. */
  chunkSpan(index: number): RecordSpan | null;
  /** Bind `whenComplete` to the caller's chunk walk. */
  settleOn(rest: Promise<void>): void;
}

/** What `beginCatalog` needs off the manifest: the chunk plan when there is
 *  one to decode against, and the successor pairs either way. A whole-buffer
 *  caller passes no chunk plan and decodes with `decodeTo`. */
interface CatalogSource {
  chunkBytes?: number[];
  totalBytes?: number;
  sidSuccessors?: readonly [number, number][];
}

function beginCatalog(
  ab: ArrayBuffer,
  constellations: Constellation[],
  manifest: CatalogSource,
): GrowingCatalog {
  const header = readCatalogHeader(ab);
  const { count, nameTableOffset, nameTableLength } = header;
  const offset = recordsOffset(header);

  const columns = allocateCatalogColumns(count);
  // ./README.md § Progressive catalog load, the undecoded-tail list.
  columns.companion.fill(-1);

  const names = new Map<number, string>();
  const offsetToName = readNameTable(ab, nameTableOffset, nameTableLength);

  const listeners = new Set<(span: DecodedSpan) => void>();
  let loadedCount = 0;
  let solIndex = -1;

  const catalog: GrowingCatalog = {
    count,
    get loadedCount() { return loadedCount; },
    ...columns,
    names,
    get solIndex() { return solIndex; },
    constellations,
    sidSuccessors: new Map(manifest.sidSuccessors ?? []),
    whenComplete: Promise.resolve(),

    onRecordsDecoded(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    absorb(window) {
      const { first, count: length } = window;
      if (length === 0) return;
      for (const [key, stride] of CATALOG_WINDOW_COLUMNS) {
        copyWindowColumn(columns[key], window.columns[key], first * stride);
      }
      if (window.solIndex >= 0) solIndex = first + window.solIndex;
      for (let k = 0; k < window.namedAt.length; k++) {
        const name = offsetToName.get(window.namedOffsets[k]);
        if (name) names.set(first + window.namedAt[k], name);
      }
      loadedCount = first + length;
      for (const listener of listeners) listener({ first, end: loadedCount });
    },

    chunkSpan(index) {
      if (!manifest.chunkBytes) throw new Error('chunkSpan needs a chunked manifest');
      const span = chunkRecordSpan(manifest as CatalogManifest, index, offset, count);
      return span.end > span.first ? span : null;
    },

    settleOn(rest) {
      // Writable only here: the interface exposes it readonly so a consumer
      // cannot swap the promise the boot sequence is gated on.
      (catalog as { whenComplete: Promise<void> }).whenComplete = rest.then(() => {
        if (loadedCount !== count) {
          throw new Error(
            `Catalog load settled at ${loadedCount} of ${count} records`,
          );
        }
      });
    },
  };

  return catalog;
}
