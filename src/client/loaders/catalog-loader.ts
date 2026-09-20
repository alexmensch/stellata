import {
  APSIS_FIELDS,
  type ApsisField,
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  NO_COMPANION,
  decodeRecordColumn,
  decodeRecordColumnBig,
  readCatalogHeader,
  readNameTable,
  recordsOffset,
  AMP_MAG_PER_UNIT,
  PERIOD_DAYS_PER_UNIT,
  type DecodeRecordColumnOptions,
  type CatalogManifest,
  type RecordSpan,
} from '../../../scripts/catalog/record/catalog-pure';
import { chunkRecordSpan, startChunkFetches } from './catalog-progressive';
import { writePulsationParams } from '../star-pipeline/pulsation/pulsation-params-pure';

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
   *  chunks land, and equal to `count` once `whenComplete` settles. Records
   *  are apparent-brightness ordered, so the prefix is always the
   *  brightest-looking sky rather than an arbitrary subset. Anything that
   *  walks the catalogue during load bounds itself here; past it the arrays
   *  hold zeros, and a zero position is Sol's own. */
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
  const catalog = beginCatalog(assembled.buffer, constellations, manifest);
  // Resolve on the first chunk that carries a whole record, not merely on
  // chunk 0: the header and the name table precede the records, so on a
  // small artifact chunk 0 can decode to nothing and boot would have no
  // star to paint.
  let next = 1;
  while (catalog.loadedCount === 0 && next < fetches.length) {
    await fetches[next];
    catalog.absorbChunk(next);
    next++;
  }
  const from = next;
  catalog.settleOn((async () => {
    for (let i = from; i < fetches.length; i++) {
      await fetches[i];
      catalog.absorbChunk(i);
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
  catalog.decodeTo(catalog.count);
  catalog.settleOn(Promise.resolve());
  return catalog;
}

interface GrowingCatalog extends Catalog {
  /** Decode every record the given chunk index completes. */
  absorbChunk(index: number): void;
  /** Decode forward to `end`, whatever chunk boundary it came from. */
  decodeTo(end: number): void;
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
  const view = new DataView(ab);
  const header = readCatalogHeader(ab);
  const { count, nameTableOffset, nameTableLength } = header;
  const offset = recordsOffset(header);

  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const absmag = new Float32Array(count);
  const ci = new Float32Array(count);
  const physicalRadius = new Float32Array(count);
  const spectClass = new Float32Array(count);
  const luminosityClass = new Uint8Array(count);
  const constellation = new Float32Array(count);
  const flags = new Uint8Array(count);
  const companion = new Int32Array(count);
  const periodDays = new Float32Array(count);
  const amplitudeMag = new Float32Array(count);
  const varType = new Uint8Array(count);
  const hip = new Uint32Array(count);
  const sid = new Uint32Array(count);
  const gaiaSourceId = new BigUint64Array(count);
  const multiplicityStatus = new Uint8Array(count);
  const apsis = {} as Record<ApsisField, Float32Array>;
  for (const name of APSIS_FIELDS) apsis[name] = new Float32Array(count);
  const nameOffsetArr = new Uint32Array(count);
  const companionRaw = new Uint32Array(count);
  const pulsRho = new Float32Array(count);
  const pulsColorSwing = new Float32Array(count);
  // Zero decodes as "my companion is record 0", not as absent, so the
  // undecoded tail is seeded with the real sentinel rather than a live
  // reference into the prefix.
  companion.fill(-1);

  const names = new Map<number, string>();
  const offsetToName = readNameTable(ab, nameTableOffset, nameTableLength);

  const listeners = new Set<(span: DecodedSpan) => void>();
  let loadedCount = 0;
  let solIndex = -1;

  const decodeSpan = (first: number, end: number): void => {
    if (end <= first) return;
    const span: RecordSpan = { offset, first, end };
    const column = (
      field: Parameters<typeof decodeRecordColumn>[2],
      out: Parameters<typeof decodeRecordColumn>[3],
      opts?: DecodeRecordColumnOptions,
    ) => decodeRecordColumn(view, span, field, out, opts);

    column('x', positions, { stride: 3, component: 0 });
    column('y', positions, { stride: 3, component: 1 });
    column('z', positions, { stride: 3, component: 2 });
    column('vx', velocities, { stride: 3, component: 0 });
    column('vy', velocities, { stride: 3, component: 1 });
    column('vz', velocities, { stride: 3, component: 2 });
    column('absmag', absmag);
    column('ci', ci);
    column('physRadius', physicalRadius);
    column('companion', companionRaw);
    column('nameOffset', nameOffsetArr);
    column('spectClass', spectClass);
    column('lumClass', luminosityClass);
    column('conIndex', constellation);
    column('flags', flags);
    column('varType', varType);
    column('ampUnits', amplitudeMag, { scale: AMP_MAG_PER_UNIT });
    column('period', periodDays, { scale: PERIOD_DAYS_PER_UNIT });
    column('hip', hip);
    column('sid', sid);
    column('multiplicityStatus', multiplicityStatus);
    for (const name of APSIS_FIELDS) column(name, apsis[name]);
    decodeRecordColumnBig(view, span, 'gaiaSourceId', gaiaSourceId);

    for (let i = first; i < end; i++) {
      if (companionRaw[i] !== NO_COMPANION) companion[i] = companionRaw[i];
      if (flags[i] & FLAG_IS_SOL) solIndex = i;
      if (flags[i] & FLAG_HAS_NAME) {
        const name = offsetToName.get(nameOffsetArr[i]);
        if (name) names.set(i, name);
      }
    }
    writePulsationParams(varType, pulsRho, pulsColorSwing, first, end);
  };

  const catalog: GrowingCatalog = {
    count,
    get loadedCount() { return loadedCount; },
    positions,
    velocities,
    absmag,
    ci,
    spectClass,
    luminosityClass,
    physicalRadius,
    constellation,
    flags,
    companion,
    periodDays,
    amplitudeMag,
    varType,
    pulsRho,
    pulsColorSwing,
    hip,
    sid,
    gaiaSourceId,
    multiplicityStatus,
    ...apsis,
    names,
    get solIndex() { return solIndex; },
    constellations,
    sidSuccessors: new Map(manifest.sidSuccessors ?? []),
    whenComplete: Promise.resolve(),

    onRecordsDecoded(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    decodeTo(end) {
      const first = loadedCount;
      if (end <= first) return;
      decodeSpan(first, end);
      loadedCount = end;
      for (const listener of listeners) listener({ first, end });
    },

    absorbChunk(index) {
      if (!manifest.chunkBytes) throw new Error('absorbChunk needs a chunked manifest');
      catalog.decodeTo(
        chunkRecordSpan(manifest as CatalogManifest, index, offset, count).end,
      );
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

  catalog.decodeTo(
    manifest.chunkBytes
      ? chunkRecordSpan(manifest as CatalogManifest, 0, offset, count).end
      : 0,
  );
  return catalog;
}
