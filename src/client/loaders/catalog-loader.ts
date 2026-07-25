import {
  APSIS_FIELDS,
  type ApsisField,
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  NO_COMPANION,
  catalogChunkFilename,
  assembleCatalogChunks,
  decodeRecordColumn,
  decodeRecordColumnBig,
  readCatalogHeader,
  readNameTable,
  AMP_MAG_PER_UNIT,
  PERIOD_DAYS_PER_UNIT,
  type DecodeRecordColumnOptions,
  type CatalogManifest,
} from '../../../scripts/catalog/catalog-pure';
import { buildPulsationParams } from '../star-pipeline/pulsation/pulsation-params-pure';

export interface Constellation {
  code: string;
  name: string;
  // Classical stick-figure polylines, each a list of star indices into the
  // catalog record array. Populated by the build step from Stellarium's
  // modern sky culture; absent for constellations with no asterism lines.
  lines?: number[][];
}

export interface Catalog {
  count: number;
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
}

export interface LoadProgress {
  bytes: number;
  total: number;
}

export async function loadCatalog(
  manifestUrl: string,
  conUrl: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<Catalog> {
  const [{ binBuf, manifest }, constellations] = await Promise.all([
    fetchCatalogChunks(manifestUrl, onProgress),
    fetch(conUrl).then((r) => r.json() as Promise<Constellation[]>),
  ]);

  return parseBinary(binBuf, constellations, manifest.sidSuccessors);
}

async function fetchCatalogChunks(
  manifestUrl: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<{ binBuf: ArrayBuffer; manifest: CatalogManifest }> {
  const mres = await fetch(manifestUrl);
  if (!mres.ok) throw new Error(`Failed to load ${manifestUrl}: ${mres.status}`);
  const manifest = (await mres.json()) as CatalogManifest;

  // Chunk URLs are siblings of the manifest — same directory prefix, name
  // from the shared `catalogChunkFilename` so client + writer agree.
  const dirUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  let loaded = 0;
  const report = onProgress
    ? (delta: number) => {
        loaded += delta;
        onProgress({ bytes: loaded, total: manifest.totalBytes });
      }
    : undefined;
  const chunks = await Promise.all(
    manifest.chunkBytes.map((byteLength, i) =>
      fetchCatalogChunk(dirUrl + catalogChunkFilename(i), byteLength, report),
    ),
  );

  return { binBuf: assembleCatalogChunks(chunks, manifest), manifest };
}

async function fetchCatalogChunk(
  url: string,
  byteLength: number,
  onBytes?: (delta: number) => void,
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  if (!res.body || !onBytes) return new Uint8Array(await res.arrayBuffer());

  // Stream so the loading bar advances mid-chunk, not once per finished file.
  // out is pre-sized from the manifest, so a truncated response would silently
  // zero-pad and pass assembly's length check — the short-read guard rejects it.
  const out = new Uint8Array(byteLength);
  const reader = res.body.getReader();
  let off = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, off);
    off += value.byteLength;
    onBytes(value.byteLength);
  }
  if (off !== byteLength) {
    throw new Error(`Catalog chunk short read at ${url}: got ${off}, expected ${byteLength}`);
  }
  return out;
}

export function parseBinary(
  ab: ArrayBuffer,
  constellations: Constellation[],
  sidSuccessorPairs: readonly [number, number][] = [],
): Catalog {
  const view = new DataView(ab);
  const { count, nameTableOffset, nameTableLength } = readCatalogHeader(ab);

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
  // Name resolution needs the table, which sits past the records, so the
  // per-record offsets are parked here and joined after the columns land.
  const nameOffsetArr = new Uint32Array(count);
  const companionRaw = new Uint32Array(count);

  const column = (
    field: Parameters<typeof decodeRecordColumn>[2],
    out: Parameters<typeof decodeRecordColumn>[3],
    opts?: DecodeRecordColumnOptions,
  ) => decodeRecordColumn(view, count, field, out, opts);

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
  decodeRecordColumnBig(view, count, 'gaiaSourceId', gaiaSourceId);

  let solIndex = -1;
  for (let i = 0; i < count; i++) {
    companion[i] = companionRaw[i] === NO_COMPANION ? -1 : companionRaw[i];
    if (flags[i] & FLAG_IS_SOL) solIndex = i;
  }

  const { rho: pulsRho, colorSwing: pulsColorSwing } = buildPulsationParams(varType);

  const names = new Map<number, string>();
  const offsetToName = readNameTable(ab, nameTableOffset, nameTableLength);
  for (let i = 0; i < count; i++) {
    if (flags[i] & FLAG_HAS_NAME) {
      const name = offsetToName.get(nameOffsetArr[i]);
      if (name) names.set(i, name);
    }
  }

  return {
    count,
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
    solIndex,
    constellations,
    sidSuccessors: new Map(sidSuccessorPairs),
  };
}
