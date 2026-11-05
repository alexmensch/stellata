// The v10 catalog.bin record layout and both directions of its codec, the
// transport chunk plan, and the search-index.json wire entry. See README.md.

// Keep the .ts extensions. vite.config.ts imports this module, and Vite's
// native config loader strips types via Node, which resolves no extensions —
// so everything reachable from the config needs them. Only typecheck and
// vitest cover the rest of scripts/, and neither fails without them: dropping
// these breaks `vite build` and `pnpm run dev` alone.

// The two override layers sit above the cascade rather than inside it — each
// replaces the inverted distance wholesale, so they are outcomes of the routing
// and not parallax tiers. `resolveParallax` never returns either.
export const DIST_VIA_VALUES = [
  'bailer_jones',
  'lmc_kinematic',
  'gaia_dr3_inversion',
  'hip2_parallax',
  'cns5_plx',
  'gliese_plx',
  'simbad_plx',
  'pair_member_parallax',
  'gliese_photometric_plx',
  'curated',
  'none',
] as const;

export type DistVia = (typeof DIST_VIA_VALUES)[number];

/** The bottom of every chromaticity cascade: ~0.65 renders a yellow disc
 *  rather than a hot blue or cold red default. */
export const SOLAR_BV_FALLBACK = 0.65;

// ---- Variable-star fields ---------------------------------------------

// 0 = unknown, so a build predating the varType column reads as
// "non-variable" by default without a magic-version bump.
//
// Eclipsing = 2 is the load-bearing value — paired with binaries.bin's
// has_orbit flag, the runtime suppresses GCVS-amplitude pulsation for
// EA/EB/EW stars whose photometric signal now comes from the geometric-
// occlusion field instead.
//
// Codes 0–3 are stable; 4+ refine VAR_TYPE_PULSATING into pulsator
// families so the runtime can drive the per-type radius-swing / colour-
// swing table (/docs/science-stellar-modelling.md#variable-star-pulsation).
// VAR_TYPE_PULSATING (1) remains the fallback for a pulsator
// family with no dedicated bucket (RV Tauri). buildPulsationParams
// (src/client/star-pipeline/pulsation/pulsation-params-pure.ts) maps every code to
// its {ρ, ΔB−V}; a non-pulsator or unbucketed code takes the default row.
export const VAR_TYPE_UNKNOWN = 0;
export const VAR_TYPE_PULSATING = 1;
export const VAR_TYPE_ECLIPSING = 2;
export const VAR_TYPE_OTHER = 3;
export const VAR_TYPE_MIRA = 4;
export const VAR_TYPE_SEMIREGULAR = 5;
export const VAR_TYPE_CEPHEID = 6;
export const VAR_TYPE_RR_LYRAE = 7;
export const VAR_TYPE_DSCT = 8;

// Multiplicity status stored at RECORD_LAYOUT.multiplicityStatus.
// `resolved` = the record participates in a multiples.tsv system (a
// companion is resolved in the model); `unresolved` = SIMBAD flags the
// star as a multiple (otype '**') but no companion resolves — the
// spectroscopic-binary population invisible to WDS/CCDM/NSS (64 Vir).
export const MULTIPLICITY_SINGLE = 0;
export const MULTIPLICITY_RESOLVED = 1;
export const MULTIPLICITY_UNRESOLVED = 2;

// Decode steps of the two quantised variability fields — the multipliers
// both readers apply to the stored unit. Kept as the decode-side spelling
// of the encoders below (0.05 = 1/20, 0.1 = 1/10) rather than dividing by
// the encoder's factor: `n * 0.05` and `n / 20` disagree in the last bit,
// and the shipped amplitudes are the multiplied form. The round-trip
// through both is pinned in catalog-pure.test.ts.
export const AMP_MAG_PER_UNIT = 0.05;
export const PERIOD_DAYS_PER_UNIT = 0.1;

/** Amplitude byte: 0.05 mag quanta, saturating at 12.75 mag. */
export function encodeAmpUnits(amplitudeMag: number): number {
  return Math.min(255, Math.max(0, Math.round(amplitudeMag * 20)));
}

/** Period uint16: 0.1 d quanta, saturating at 6553.5 d. */
export function encodePeriodUnits(periodDays: number): number {
  return Math.min(65535, Math.max(0, Math.round(periodDays * 10)));
}

// ---- Binary catalog format ----------------------------------------------

// Single source of truth for the catalog.bin file layout, shared by the
// writer (scripts/catalog/build-catalog), the runtime reader
// (src/client/loaders/catalog-loader), and the verify tool
// (scripts/catalog/validate/verify-catalog).
//
// File structure:
//   [0,                       HEADER_SIZE)                              header
//   [nameTableOffset,         nameTableOffset + nameTableLength)        name table
//   [recordsOffset(header),                                 end)        records
//
// The name table precedes the records so the first transport chunk decodes
// standalone: a progressive load paints its prefix with real names rather
// than composed designations (see README.md#on-disk-transport-chunking).
//
// HEADER_LAYOUT / RECORD_LAYOUT below carry the per-field byte offsets;
// HEADER_FIELD_KINDS / RECORD_FIELD_KINDS carry the matching wire types
// (byte widths derive from the kind). Adding/changing a field means: bump
// BINARY_VERSION + MAGIC, extend the LAYOUT + KINDS pair with the new
// offset and kind, and the writer + reader + tests pick the change up
// automatically.

export const MAGIC = 'HYGA';
export const BINARY_VERSION = 10;
export const HEADER_SIZE = 32;
export const RECORD_SIZE = 100;
// Bytes 97..99 are reserved (zero-filled): the v9 multiplicityStatus uint8
// lands at 96 and the stride stays a multiple of 4. A future field taking a
// reserved byte still needs a BINARY_VERSION bump — readers must know the
// byte is populated.
export const RECORD_RESERVED_TAIL_BYTES = 3;
export const NO_COMPANION = 0xffffffff;
// Reserved none/invalid SID sentinel (/docs/sid.md#2-identity-model--three-layers); allocation starts
// at 1, so 0 in RECORD_LAYOUT.sid means the record resolved to no ledger
// row — a state build-catalog.ts writes only in its unallocated-bootstrap
// path before hard-failing (/scripts/catalog/README.md#sid-allocation).
export const NO_SID = 0;
// Sentinel uint8 stored at RECORD_LAYOUT.conIndex when the star has no
// constellation assignment. Valid IAU constellation indexes are
// 0..87 (88 modern constellations); 255 is unambiguous.
export const NO_CONSTELLATION_INDEX = 0xff;
// Sentinel uint64 stored at RECORD_LAYOUT.gaiaSourceId when the manifest
// carries no `gaia_source_id`. Valid Gaia DR3 source_ids are positive 63-bit
// integers, so 0 is unambiguous.
export const NO_GAIA_SOURCE_ID = 0n;
// Float32 NaN is the null sentinel for the seven Gaia DR3 Apsis fields
// (teff/logg/[M/H]/A0 from gspphot ∪ gspspec). NaN survives IEEE-754
// round-trip through DataView.setFloat32/getFloat32 and never collides
// with a physical value — Teff > 0, logg > 0, A0 ≥ 0, [M/H] is finite.
// Consumers test with `Number.isNaN(x)`.
export const NO_APSIS = NaN;

// On-disk transport chunking — the single reassembly contract shared by the
// writer, client loader, and Node reader. See /src/catalog-format/record/README.md#on-disk-transport-chunking.

export const CATALOG_MANIFEST_FILENAME = 'catalog-manifest.json';

// 16 MiB keeps every chunk clear of the 25 MiB Workers ceiling with growth
// headroom — do not raise toward 25 or a fuller catalog breaks deploy.
export const CATALOG_CHUNK_TARGET_BYTES = 16 * 1024 * 1024;

// Chunk 0 is the first-paint payload, not a transport unit, so it is sized
// for latency rather than against the Workers ceiling. Flattening the ramp
// to CATALOG_CHUNK_TARGET_BYTES to save requests costs first paint an order
// of magnitude — see ./README.md#on-disk-transport-chunking.
export const CATALOG_FIRST_CHUNK_TARGET_BYTES = 1024 * 1024;

export interface CatalogManifest {
  /** Byte length of each chunk in `catalog.bin.<i>` order. */
  chunkBytes: number[];
  /** Sum of chunkBytes — assembled length, for pre-alloc + integrity check. */
  totalBytes: number;
  /** Retired-sid → successor-sid pairs (/docs/sid.md#94-migration-semantics--exact-table). Omitted when
   *  no effectively-retired sid carries a successor (merge-type
   *  retirements only exist after a DR reconciliation). */
  sidSuccessors?: [number, number][];
}

export function catalogChunkFilename(index: number): string {
  return `catalog.bin.${index}`;
}

export const CATALOG_CHUNK_FILENAME = /^catalog\.bin\.\d+$/;

/** Split a total byte length into sequential per-chunk lengths, doubling
 *  from `firstBytes` up to a `targetBytes` ceiling. A zero-length buffer
 *  yields one empty chunk so the manifest always carries ≥1 entry. */
export function planCatalogChunks(
  totalBytes: number,
  targetBytes: number = CATALOG_CHUNK_TARGET_BYTES,
  firstBytes: number = CATALOG_FIRST_CHUNK_TARGET_BYTES,
): number[] {
  if (targetBytes <= 0) throw new Error(`Invalid chunk target: ${targetBytes}`);
  if (firstBytes <= 0) throw new Error(`Invalid first-chunk target: ${firstBytes}`);
  if (totalBytes <= 0) return [0];
  const chunkBytes: number[] = [];
  let step = Math.min(firstBytes, targetBytes);
  for (let off = 0; off < totalBytes; off += step, step = Math.min(step * 2, targetBytes)) {
    chunkBytes.push(Math.min(step, totalBytes - off));
  }
  return chunkBytes;
}

/** Byte offset chunk `index` lands at in the assembled buffer. */
export function catalogChunkOffset(chunkBytes: readonly number[], index: number): number {
  let off = 0;
  for (let i = 0; i < index; i++) off += chunkBytes[i];
  return off;
}

/** How many records the first `chunkCount` chunks fully contain, given the
 *  buffer offset record 0 sits at. A record straddling the boundary belongs
 *  to the later chunk, so this never reports one the prefix cannot decode. */
export function recordsInChunkPrefix(
  chunkBytes: readonly number[],
  chunkCount: number,
  offset: number,
  count: number,
): number {
  const bytes = catalogChunkOffset(chunkBytes, chunkCount);
  return Math.max(0, Math.min(count, Math.floor((bytes - offset) / RECORD_SIZE)));
}

/** Concatenate transport chunks back into the assembled buffer, validating
 *  each length and the running total against the manifest. */
export function assembleCatalogChunks(
  chunks: Uint8Array[],
  manifest: CatalogManifest,
): ArrayBuffer {
  if (chunks.length !== manifest.chunkBytes.length) {
    throw new Error(
      `Catalog chunk count mismatch: got ${chunks.length}, manifest expects ${manifest.chunkBytes.length}`,
    );
  }
  const out = new Uint8Array(manifest.totalBytes);
  let off = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].byteLength !== manifest.chunkBytes[i]) {
      throw new Error(
        `Catalog chunk ${i} length mismatch: got ${chunks[i].byteLength}, manifest expects ${manifest.chunkBytes[i]}`,
      );
    }
    out.set(chunks[i], off);
    off += chunks[i].byteLength;
  }
  if (off !== manifest.totalBytes) {
    throw new Error(
      `Catalog assembly size mismatch: assembled ${off}, manifest total ${manifest.totalBytes}`,
    );
  }
  return out.buffer;
}

// Wire type of a layout field. Widths derive from the kind via
// FIELD_KIND_BYTES, so a field's type and size can never disagree.
export type FieldKind = 'u8' | 'u16' | 'u32' | 'u64' | 'f32' | 'ascii4';

export const FIELD_KIND_BYTES: Record<FieldKind, number> = {
  u8: 1, u16: 2, u32: 4, u64: 8, f32: 4, ascii4: 4,
};

function fieldSizes<K extends string>(kinds: Record<K, FieldKind>): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const name of Object.keys(kinds) as K[]) out[name] = FIELD_KIND_BYTES[kinds[name]];
  return out;
}

export const HEADER_LAYOUT = {
  magic: 0,
  version: 4,
  count: 8,
  nameTableOffset: 12,
  nameTableLength: 16,
  // bytes 20..31 reserved
} as const;

/** Wire type per HEADER_LAYOUT field. Single source of truth shared with
 *  the layout regression tests so size assertions can't drift from the
 *  actual encoding. */
export const HEADER_FIELD_KINDS: Record<keyof typeof HEADER_LAYOUT, FieldKind> = {
  magic: 'ascii4',
  version: 'u32',
  count: 'u32',
  nameTableOffset: 'u32',
  nameTableLength: 'u32',
};

export const HEADER_FIELD_SIZES = fieldSizes(HEADER_FIELD_KINDS);

export const RECORD_LAYOUT = {
  x: 0,
  y: 4,
  z: 8,
  absmag: 12,
  ci: 16,
  physRadius: 20,
  companion: 24,  // NO_COMPANION = none
  nameOffset: 28, // 0 = unnamed
  spectClass: 32,
  lumClass: 33,
  conIndex: 34,   // NO_CONSTELLATION_INDEX = none
  flags: 35,      // FLAG_*
  ampUnits: 36,   // ×0.05 mag
  varType: 37,    // VAR_TYPE_*; 0 = unknown / non-variable
  period: 38,     // ×0.1 days
  hip: 40,        // 0 = no HIP
  gaiaSourceId: 44, // 0 = no Gaia DR3 source_id
  // Gaia DR3 Apsis (gspphot ∪ gspspec). NO_APSIS (NaN) for the ~15% gap.
  teffGspphot: 52,  // K
  loggGspphot: 56,  // log cgs
  mhGspphot: 60,    // [M/H] dex
  azeroGspphot: 64, // mag, line-of-sight extinction
  teffGspspec: 68,  // K
  loggGspspec: 72,  // log cgs
  mhGspspec: 76,    // [M/H] dex
  sid: 80,          // Stellata ID (0 = NO_SID; /docs/sid.md#7-storage--sid-in-every-artifact)
  // Space-motion velocity, equatorial Cartesian pc/yr (Sol at origin).
  // Consumed once at load by the epoch-advance pass; positions stay at
  // the fixed J2016.0 scene epoch on disk. See /scripts/catalog/parse/README.md#space-motion-velocity
  // and /docs/science-catalog-ingestion.md#current-epoch-star-positions--space-motion-propagation-to-t.
  vx: 84,
  vy: 88,
  vz: 92,
  multiplicityStatus: 96, // MULTIPLICITY_*
} as const;

/** Wire type per RECORD_LAYOUT field. As with HEADER_FIELD_KINDS the test
 *  suite derives non-overlap + bound checks from this map so any new field
 *  gets coverage by extending one place. Literal (`as const`) so
 *  `readRecordField` can reject a u64 field at compile time. */
export const RECORD_FIELD_KINDS = {
  x: 'f32', y: 'f32', z: 'f32', absmag: 'f32', ci: 'f32', physRadius: 'f32',
  companion: 'u32', nameOffset: 'u32',
  spectClass: 'u8', lumClass: 'u8', conIndex: 'u8', flags: 'u8', ampUnits: 'u8',
  varType: 'u8', period: 'u16', hip: 'u32', gaiaSourceId: 'u64',
  teffGspphot: 'f32', loggGspphot: 'f32', mhGspphot: 'f32', azeroGspphot: 'f32',
  teffGspspec: 'f32', loggGspspec: 'f32', mhGspspec: 'f32', sid: 'u32',
  vx: 'f32', vy: 'f32', vz: 'f32',
  multiplicityStatus: 'u8',
} as const satisfies Record<keyof typeof RECORD_LAYOUT, FieldKind>;

export type RecordField = keyof typeof RECORD_LAYOUT;

type RecordFieldOfKind<K extends FieldKind> = {
  [F in RecordField]: (typeof RECORD_FIELD_KINDS)[F] extends K ? F : never;
}[RecordField];

/** Every record field except the u64 `gaiaSourceId` — the ones whose value
 *  fits a JS number. */
export type NumericRecordField = RecordFieldOfKind<'f32' | 'u8' | 'u16' | 'u32'>;
export type BigRecordField = RecordFieldOfKind<'u64'>;
export type Float32RecordField = RecordFieldOfKind<'f32'>;

export const RECORD_FIELD_SIZES = fieldSizes(RECORD_FIELD_KINDS);

/** The seven Gaia DR3 Apsis float32 columns in record-layout order — the
 *  writer, runtime loader, Node reader, and test mock all loop over this
 *  tuple, so a v-next Apsis-shaped field is a one-entry extension here. */
export const APSIS_FIELDS = [
  'teffGspphot', 'loggGspphot', 'mhGspphot', 'azeroGspphot',
  'teffGspspec', 'loggGspspec', 'mhGspspec',
] as const;
export type ApsisField = (typeof APSIS_FIELDS)[number];

// Wire-ready values for one catalog record: sentinels applied, variability
// pre-encoded (encodeAmpUnits / encodePeriodUnits), Apsis gaps as NO_APSIS.
export interface WireStarRecord {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  absmag: number;
  ci: number;
  physRadius: number;
  companionIdx: number;   // NO_COMPANION = none
  nameOffset: number;     // 0 = unnamed
  spectClass: number;
  lumClass: number;
  conIndex: number;
  flags: number;
  ampUnits: number;       // ×0.05 mag
  periodUnits: number;    // ×0.1 days
  varType: number;
  hip: number;            // 0 = none
  gaiaSourceId: bigint;   // 0n = none
  apsis: Record<ApsisField, number>; // NO_APSIS (NaN) = absent
  sid: number;
  multiplicityStatus: number; // MULTIPLICITY_*
}

/** Encode one record at byte `off` — the writer side of the layout
 *  contract, shared by build-catalog.ts and the loader round-trip tests
 *  so a writer-only encoding bug can't ship untested. */
export function writeStarRecord(view: DataView, off: number, r: WireStarRecord): void {
  view.setFloat32(off + RECORD_LAYOUT.x, r.x, true);
  view.setFloat32(off + RECORD_LAYOUT.y, r.y, true);
  view.setFloat32(off + RECORD_LAYOUT.z, r.z, true);
  view.setFloat32(off + RECORD_LAYOUT.vx, r.vx, true);
  view.setFloat32(off + RECORD_LAYOUT.vy, r.vy, true);
  view.setFloat32(off + RECORD_LAYOUT.vz, r.vz, true);
  view.setFloat32(off + RECORD_LAYOUT.absmag, r.absmag, true);
  view.setFloat32(off + RECORD_LAYOUT.ci, r.ci, true);
  view.setFloat32(off + RECORD_LAYOUT.physRadius, r.physRadius, true);
  view.setUint32(off + RECORD_LAYOUT.companion, r.companionIdx >>> 0, true);
  view.setUint32(off + RECORD_LAYOUT.nameOffset, r.nameOffset >>> 0, true);
  view.setUint8(off + RECORD_LAYOUT.spectClass, r.spectClass);
  view.setUint8(off + RECORD_LAYOUT.lumClass, r.lumClass);
  view.setUint8(off + RECORD_LAYOUT.conIndex, r.conIndex);
  view.setUint8(off + RECORD_LAYOUT.flags, r.flags);
  view.setUint8(off + RECORD_LAYOUT.ampUnits, r.ampUnits);
  view.setUint16(off + RECORD_LAYOUT.period, r.periodUnits, true);
  view.setUint8(off + RECORD_LAYOUT.varType, r.varType & 0xff);
  view.setUint32(off + RECORD_LAYOUT.hip, r.hip, true);
  view.setBigUint64(off + RECORD_LAYOUT.gaiaSourceId, r.gaiaSourceId, true);
  for (const name of APSIS_FIELDS) {
    view.setFloat32(off + RECORD_LAYOUT[name], r.apsis[name], true);
  }
  view.setUint32(off + RECORD_LAYOUT.sid, r.sid, true);
  view.setUint8(off + RECORD_LAYOUT.multiplicityStatus, r.multiplicityStatus);
}

/** Reserved bytes (20..31) stay zero. */
export function writeCatalogHeader(
  view: DataView,
  fields: { count: number; nameTableOffset: number; nameTableLength: number },
): void {
  const bytes = new Uint8Array(view.buffer, view.byteOffset);
  for (let i = 0; i < MAGIC.length; i++) bytes[HEADER_LAYOUT.magic + i] = MAGIC.charCodeAt(i);
  view.setUint32(HEADER_LAYOUT.version, BINARY_VERSION, true);
  view.setUint32(HEADER_LAYOUT.count, fields.count, true);
  view.setUint32(HEADER_LAYOUT.nameTableOffset, fields.nameTableOffset, true);
  view.setUint32(HEADER_LAYOUT.nameTableLength, fields.nameTableLength, true);
}

export function readRecordField(
  view: DataView,
  recordOff: number,
  field: NumericRecordField,
): number {
  const off = recordOff + RECORD_LAYOUT[field];
  const kind: FieldKind = RECORD_FIELD_KINDS[field];
  switch (kind) {
    case 'f32': return view.getFloat32(off, true);
    case 'u8': return view.getUint8(off);
    case 'u16': return view.getUint16(off, true);
    case 'u32': return view.getUint32(off, true);
    default: throw new Error(`readRecordField: ${field} is ${kind}, not a numeric field`);
  }
}

/** `readRecordField` for the u64 fields, whose values exceed 2^53 and so
 *  must stay BigInt. */
export function readRecordFieldBig(
  view: DataView,
  recordOff: number,
  field: BigRecordField,
): bigint {
  return view.getBigUint64(recordOff + RECORD_LAYOUT[field], true);
}

export type RecordColumnSink = Float32Array | Uint8Array | Uint16Array | Uint32Array;

export interface DecodeRecordColumnOptions {
  /** Elements per record in `out` — 3 for the xyz / velocity triples. */
  stride?: number;
  /** Which element of the stride this field fills. */
  component?: number;
  /** Multiplier applied on read: the quantisation step of a scaled field
   *  (AMP_MAG_PER_UNIT, PERIOD_DAYS_PER_UNIT). */
  scale?: number;
}

/** The half-open record window a bulk decode covers, against the buffer
 *  offset record 0 sits at. The progressive loader decodes one chunk's
 *  window at a time; a whole-buffer read passes `{ offset, first: 0, end:
 *  count }`. */
export interface RecordSpan {
  offset: number;
  first: number;
  end: number;
}

export function wholeRecordSpan(
  header: Pick<CatalogHeaderFields, 'count' | 'nameTableOffset' | 'nameTableLength'>,
): RecordSpan {
  return { offset: recordsOffset(header), first: 0, end: header.count };
}

/** Decode one field across a record window into a parallel array — the
 *  bulk counterpart of `readRecordField` for the SoA runtime loader.
 *  Column-at-a-time (one kind dispatch per column, then a tight
 *  constant-getter loop) decodes the full catalog measurably faster
 *  than a per-record pass over every field. */
export function decodeRecordColumn(
  view: DataView,
  { offset, first, end }: RecordSpan,
  field: NumericRecordField,
  out: RecordColumnSink,
  { stride = 1, component = 0, scale = 1 }: DecodeRecordColumnOptions = {},
): void {
  const base = offset + RECORD_LAYOUT[field];
  const kind: FieldKind = RECORD_FIELD_KINDS[field];
  switch (kind) {
    case 'f32':
      for (let i = first; i < end; i++) {
        out[i * stride + component] = view.getFloat32(base + i * RECORD_SIZE, true) * scale;
      }
      return;
    case 'u8':
      for (let i = first; i < end; i++) {
        out[i * stride + component] = view.getUint8(base + i * RECORD_SIZE) * scale;
      }
      return;
    case 'u16':
      for (let i = first; i < end; i++) {
        out[i * stride + component] = view.getUint16(base + i * RECORD_SIZE, true) * scale;
      }
      return;
    case 'u32':
      for (let i = first; i < end; i++) {
        out[i * stride + component] = view.getUint32(base + i * RECORD_SIZE, true) * scale;
      }
      return;
    default:
      throw new Error(`decodeRecordColumn: ${field} is ${kind}, not a numeric field`);
  }
}

/** `decodeRecordColumn` for the u64 fields. */
export function decodeRecordColumnBig(
  view: DataView,
  { offset, first, end }: RecordSpan,
  field: BigRecordField,
  out: BigUint64Array,
): void {
  const base = offset + RECORD_LAYOUT[field];
  for (let i = first; i < end; i++) {
    out[i] = view.getBigUint64(base + i * RECORD_SIZE, true);
  }
}

export interface CatalogHeaderFields {
  magic: string;
  version: number;
  count: number;
  nameTableOffset: number;
  nameTableLength: number;
}

/** Decode + validate the fixed-size header. Both readers reject a foreign
 *  magic or an off-version binary here rather than misreading records
 *  against the wrong layout. */
export function readCatalogHeader(buffer: ArrayBuffer): CatalogHeaderFields {
  const view = new DataView(buffer);
  const magic = new TextDecoder().decode(
    new Uint8Array(buffer, HEADER_LAYOUT.magic, HEADER_FIELD_SIZES.magic),
  );
  if (magic !== MAGIC) throw new Error(`Bad magic: ${magic}`);
  const version = view.getUint32(HEADER_LAYOUT.version, true);
  if (version !== BINARY_VERSION) {
    throw new Error(`Unsupported catalog version: ${version} (expected ${BINARY_VERSION})`);
  }
  return {
    magic,
    version,
    count: view.getUint32(HEADER_LAYOUT.count, true),
    nameTableOffset: view.getUint32(HEADER_LAYOUT.nameTableOffset, true),
    nameTableLength: view.getUint32(HEADER_LAYOUT.nameTableLength, true),
  };
}

/** Byte offset of record 0. Every reader derives it rather than assuming a
 *  constant, so the name table can sit ahead of the records. */
export function recordsOffset(
  header: Pick<CatalogHeaderFields, 'nameTableOffset' | 'nameTableLength'>,
): number {
  return header.nameTableOffset + header.nameTableLength;
}

// Name table layout: two zero bytes of padding so name offset 0 reads as
// the "no name" sentinel, followed by length-prefixed UTF-8 strings:
// uint16 byteLen, then byteLen bytes.
export const NAME_TABLE_PADDING = 2;
export const NAME_LENGTH_PREFIX_BYTES = 2;

export interface EncodedNameTable {
  bytes: Uint8Array;
  /** Per input index, the offset RECORD_LAYOUT.nameOffset stores; 0 = none. */
  offsets: Uint32Array;
  entries: number;
}

/** Encode one name per record into the name table; a null or empty name
 *  gets offset 0, the "no name" sentinel. */
export function encodeNameTable(names: readonly (string | null)[]): EncodedNameTable {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [new Uint8Array(NAME_TABLE_PADDING)];
  const offsets = new Uint32Array(names.length);
  let length = NAME_TABLE_PADDING;
  let entries = 0;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!name) continue;
    const encoded = encoder.encode(name);
    if (encoded.length > 0xffff) throw new Error(`Name too long: ${name}`);
    offsets[i] = length;
    const lenHeader = new Uint8Array(NAME_LENGTH_PREFIX_BYTES);
    new DataView(lenHeader.buffer).setUint16(0, encoded.length, true);
    chunks.push(lenHeader, encoded);
    length += NAME_LENGTH_PREFIX_BYTES + encoded.length;
    entries++;
  }
  const bytes = new Uint8Array(length);
  let off = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, off);
    off += chunk.length;
  }
  return { bytes, offsets, entries };
}

/** Decode the name table into `nameOffset` → name, keyed by the offset
 *  RECORD_LAYOUT.nameOffset stores (relative to the table start). The
 *  reader side of `encodeNameTable`, shared by both readers. */
export function readNameTable(
  buffer: ArrayBuffer,
  nameTableOffset: number,
  nameTableLength: number,
): Map<number, string> {
  const out = new Map<number, string>();
  if (nameTableLength <= 0) return out;
  const decoder = new TextDecoder('utf-8');
  const bytes = new Uint8Array(buffer, nameTableOffset, nameTableLength);
  const view = new DataView(buffer, nameTableOffset, nameTableLength);
  let p = NAME_TABLE_PADDING;
  while (p < nameTableLength) {
    const len = view.getUint16(p, true);
    const entryOffset = p;
    p += NAME_LENGTH_PREFIX_BYTES;
    out.set(entryOffset, decoder.decode(bytes.subarray(p, p + len)));
    p += len;
  }
  return out;
}

// ---- search-index.json wire contract ------------------------------------

// One entry per searchable star written by build-catalog.ts and consumed
// by src/client/typeahead/search.ts. Keys are short
// (i/p/b/f/c/s/g/hip/hd/hr/gl/cl/cp) for wire size — the index is ~15 MB raw
// with hundreds of thousands of entries. Sharing the interface across
// writer + reader is the contract: drift here ships a broken index.
export interface SearchEntry {
  i: number;     // record index in the binary catalog
  /** Display NAME — the ladder's authority tiers only (Sirius, Ross 128,
   *  Sirius B). A record displaying a DESIGNATION carries none: the runtime
   *  composes that from the structure below, through the same composer the
   *  build used (/docs/star-naming.md#6-rendering--glyphs-everywhere-no-fallback-path). */
  p?: string;
  b?: string;    // Bayer letter glyph — Greek (α) or bare Latin (p, A)
  bx?: number;   // Bayer superscript, absent when none
  /** Component the authority attributes the Bayer designation to (κ Her B).
   *  Unlike `cl` it renders unconditionally — see star-naming-pure.ts. */
  bc?: string;
  f?: number;    // Flamsteed number
  gd?: number;   // Gould number
  gh?: string;   // Gould Serpens half (Cap / Cau), part of the designation
  c?: number;    // positional constellation index (255 = none, omitted)
  dc?: number;   // designation's constellation index, only when it differs from c
  s?: string;    // spectral designation, cleaned for display
  g?: string;    // GCVS variable-star designation (R CrB, VY CMa, V0645 Cen)
  hip?: number;  // Hipparcos catalogue number
  hd?: number;   // Henry Draper number
  hr?: number;   // Harvard Revised / Yale BSC number
  // Further HD / HR numbers the record answers to but does not display. HD
  // numbered both components of many close pairs and HR routes through HD, so
  // these two are the identifiers an overlay cell can be ambiguous on
  // (../../../scripts/catalog/classic-ids/label-merge/README.md). Search resolves them; the
  // dropdown label stays the record's own designation.
  hda?: number[];
  hra?: number[];
  gl?: string;   // Gliese / GJ designation
  cl?: string;   // multiple-star component letter (A/B/C/Ab…) — see search.ts
  cp?: number;   // WDS root anchor's record index; base for "<designation> <cl>"
  /** Published spellings that resolve a search and never display — a name
   *  the ladder displaced, or an approved alternate. Strings no structure
   *  implies; every derivable spelling is derived (/docs/star-naming.md#5-aliases--ship-what-cannot-be-derived-derive-what-can). */
  al?: string[];
}

// Structural subset of Star the search index draws from. Local so this
// module stays free of the stars-parse import (which depends on it).
export interface SearchEntrySource {
  proper: string | null;
  bayer: string | null;
  bayerSup: number | null;
  bayerComponent: string | null;
  gould: number | null;
  gouldHalf: string | null;
  aliases: readonly string[];
  flam: number | null;
  hip: number | null;
  hd: number | null;
  hr: number | null;
  hdAlt: readonly number[];
  hrAlt: readonly number[];
  gl: string | null;
  gcvsName: string | null;
  conIndex: number;
  /** The constellation the record's designations are named for, where one is stated. */
  desigCon: { readonly index: number } | { readonly via: 'none' };
  spectDisplay: string | null;
}

/** Which constellation a Bayer / Flamsteed / GCVS designation is rendered
 *  against. Byte 34 is positional, and the two diverge once a boundary moves
 *  past a named star (ρ Aql / 67 Aql is Delphinus but keeps its Aquila
 *  designation), so the editorial index wins wherever one is known. Shared by
 *  the build (`Star`) and the wire reader (`SearchEntry.dc ?? .c`) so the
 *  precedence is stated once. */
export function designationConIndex(
  desigConIndex: number | undefined,
  positionalConIndex: number | undefined,
): number {
  if (desigConIndex !== undefined && desigConIndex !== NO_CONSTELLATION_INDEX) {
    return desigConIndex;
  }
  return positionalConIndex ?? NO_CONSTELLATION_INDEX;
}

// Sole writer of the SearchEntry wire shape (build-catalog.ts calls it);
// src/client/typeahead/search.ts is the reader. Returns null for a star
// with no identifier a user could type. Each optional field is set only
// when present, so JSON.stringify never emits an explicit null/undefined
// key — the reader treats a missing key and an absent value alike.
/** Index every number a record answers to onto its record index: the numbers
 *  records DISPLAY first, then the aliases beside them.
 *
 *  Two passes and first-write-wins, which settles two collisions with one rule.
 *  Entries arrive apparent-brightest-first (README.md#record-order fixes record
 *  order), so an ambiguous designation resolves to the record that LOOKS
 *  brightest — 57 HD
 *  and 11 HR numbers are displayed by two records each, always a component pair
 *  sharing one catalogue number, and `Gl 277A` likewise. And an alias never
 *  displaces a record that displays that number outright, whichever way the
 *  record order happened to place the two.
 *  `../../../scripts/catalog/classic-ids/label-merge/README.md#an-alias-stops-at-the-blend`
 * is the same rule on the write side;
 *  `cns5AstrometryByGj` is the same two-pass reduction over CNS5's component
 *  letters.
 *
 *  Every identifier map the search box dispatches on is built here, including
 *  the two that carry no aliases: the brightest-wins rule is a property of the
 *  identifier being ambiguous, not of it having an alias list, and an inline
 *  unconditional `set` silently resolved `Gl 277A` to the fainter record.
 *
 *  Many keys onto one record, never one key onto several: the direction the
 *  dropdown reads — record to label — stays single-valued. */
export function buildAliasedIdIndex<K>(
  entries: readonly SearchEntry[],
  displayed: (e: SearchEntry) => K | undefined,
  aliases?: (e: SearchEntry) => readonly K[] | undefined,
): Map<K, number> {
  const out = new Map<K, number>();
  for (const entry of entries) {
    const key = displayed(entry);
    if (key !== undefined && !out.has(key)) out.set(key, entry.i);
  }
  if (aliases !== undefined) {
    for (const entry of entries) {
      for (const key of aliases(entry) ?? []) {
        if (!out.has(key)) out.set(key, entry.i);
      }
    }
  }
  return out;
}

export function buildSearchEntry(
  s: SearchEntrySource,
  i: number,
  component: { comp: string; primaryIdx: number } | undefined,
): SearchEntry | null {
  // A promoted companion carries none of these — its display name is
  // composed from its WDS root anchor's designation plus its own letter, so
  // the component designation is itself a searchable identifier and the
  // entry has to exist for the runtime composer to reach it.
  if (!s.proper && !s.bayer && s.hip === null && s.hd === null
      && s.hr === null && s.flam === null && s.gould === null && !s.gl
      && !s.gcvsName && component === undefined) {
    return null;
  }
  const entry: SearchEntry = { i };
  if (s.proper) entry.p = s.proper;
  if (s.bayer) entry.b = s.bayer;
  if (s.bayerSup !== null) entry.bx = s.bayerSup;
  if (s.bayerComponent !== null) entry.bc = s.bayerComponent;
  if (s.flam !== null) entry.f = s.flam;
  if (s.gould !== null) entry.gd = s.gould;
  if (s.gouldHalf !== null) entry.gh = s.gouldHalf;
  if (s.aliases.length > 0) entry.al = [...s.aliases];
  if (s.hip !== null) entry.hip = s.hip;
  if (s.hd !== null) entry.hd = s.hd;
  if (s.hr !== null) entry.hr = s.hr;
  if (s.hdAlt.length > 0) entry.hda = [...s.hdAlt];
  if (s.hrAlt.length > 0) entry.hra = [...s.hrAlt];
  if (s.gl) entry.gl = s.gl;
  if (s.gcvsName) entry.g = s.gcvsName;
  if (s.conIndex !== NO_CONSTELLATION_INDEX) entry.c = s.conIndex;
  if (s.spectDisplay) entry.s = s.spectDisplay;
  if (component) {
    entry.cl = component.comp;
    entry.cp = component.primaryIdx;
  }
  // Only the constellation-relative designations read `dc`, so an entry
  // findable solely by catalogue number gains nothing from carrying it. Every
  // other star rides the reader's `dc ?? c` fallback at no wire cost.
  const hasConRelativeDesignation =
    Boolean(entry.b) || entry.f !== undefined || entry.gd !== undefined
    || Boolean(entry.g) || component !== undefined;
  if (hasConRelativeDesignation && 'index' in s.desigCon && s.desigCon.index !== s.conIndex) {
    entry.dc = s.desigCon.index;
  }
  return entry;
}

// ---- Catalog flag bits --------------------------------------------------

// Per-star bitfield stored at RECORD_LAYOUT.flags. Single source of truth
// for both writers (scripts/catalog/build-catalog, src/catalog-format/record/catalog-pure
// inferBinaries) and readers (catalog-loader, chart-labels,
// verify-catalog). Adding a bit means adding a name to the FLAGS
// registry, not sprinkling another magic number — the regression tests
// then automatically pin distinct-ness and single-bit-ness.
//
// FLAGS is the canonical registry; the FLAG_* exports below are named
// aliases for callsite readability.
export const FLAGS = {
  hasName: 0x01,
  isSol: 0x02,
  hasBayer: 0x04,
  binaryCompanionOnly: 0x08,
  binaryPrimary: 0x10,
  /** Companion addressable only via the row-index map's `bySynth`
   *  table. See ../../../scripts/catalog/companions/README.md#companion-promotion-from-databinariesmultiplestsv
   *  `data/binaries/multiples.tsv`. */
  binaryCompanionSynthetic: 0x20,
} as const;
export const FLAG_HAS_NAME = FLAGS.hasName;
export const FLAG_IS_SOL = FLAGS.isSol;
export const FLAG_HAS_BAYER = FLAGS.hasBayer;
export const FLAG_BINARY_COMPANION_ONLY = FLAGS.binaryCompanionOnly;
export const FLAG_BINARY_PRIMARY = FLAGS.binaryPrimary;
export const FLAG_BINARY_COMPANION_SYNTHETIC = FLAGS.binaryCompanionSynthetic;

/** Sol is the one record addressable only by its proper name — it carries no
 *  HIP, Gaia source_id, or SIMBAD row — so `FLAG_IS_SOL` and its `sol:sun`
 *  designation both key off this exact string. */
export const SOL_PROPER_NAME = 'Sol';

/** Sol's absolute V magnitude, curated because it cannot be derived: absmag
 *  comes from (V, distance) for every other record, and Sol sits at distance
 *  zero where that expression is undefined.
 *
 *  4.85 is the value the AT-HYG-driven build carried, kept so the swap does
 *  not move the Stefan-Boltzmann chain's calibration point (known-stars.tsv
 *  pins Sol's radius at 1.035 R☉ against it). Willmer 2018
 *  (/data/papers/index.md#willmer2018) gives M_V = 4.81 (Vega); adopting it
 *  is a deliberate recalibration, not a drift fix, and moves the pinned
 *  radius. */
export const SOL_ABSOLUTE_V_MAGNITUDE = 4.85;

/** Sol's apparent V, curated for the same reason its direction is: it carries
 *  no identifier any cascade can key on, so every machine tier misses it and
 *  V is a membership gate. Cox 2000 (/data/papers/index.md#cox2000) Sect. 12
 *  — the published value, not the printed cell the retired AT-HYG-driven
 *  build happened to carry.
 *
 *  It reaches no shipped byte: absmag takes `SOL_ABSOLUTE_V_MAGNITUDE` above
 *  rather than deriving from this, because Sol sits at distance zero. */
export const SOL_APPARENT_V_MAGNITUDE = -26.74;

/** Bits intentionally left free for future use — adding functionality
 *  that fits inside one of these does not require a BINARY_VERSION bump.
 *  The reservation is pinned by a regression test: drifting RESERVED into
 *  any FLAGS value forces a deliberate edit here. */
export const RESERVED_FLAG_BITS = 0x40 | 0x80;

// ---- Gaia DR3 Apsis astrophysical parameters ----------------------------

/** Per-source Apsis fields from `data/gaia/gaia_dr3_apsis.tsv`. The seven
 *  float columns (gspphot ∪ gspspec) are `number | null` — gspphot and
 *  gspspec are independent solutions and either or both may be absent
 *  for a given source_id. NaN-when-empty decoding lifts to the binary
 *  layer via `NO_APSIS`. `spectraltypeEsphs` is the ESP-ELS spectral-type
 *  enum: one of "O", "B", "A", "F", "G", "K", "M", "CSTAR" (Creevey 2023
 *  (/data/papers/index.md#creevey2023)), or the archive column's own
 *  "unknown"; consumed by the spectral resolver as the
 *  second tier after SIMBAD sp_type. */
export interface ApsisRow {
  teffGspphot: number | null;
  loggGspphot: number | null;
  mhGspphot: number | null;
  azeroGspphot: number | null;
  teffGspspec: number | null;
  loggGspspec: number | null;
  mhGspspec: number | null;
  spectraltypeEsphs: string | null;
}
