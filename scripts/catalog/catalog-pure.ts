// Pure, deterministic, side-effect-free transforms shared by
// build-catalog.ts and its tests — binary layout constants, the SIMBAD
// namespace ladder, GCVS field extraction, and the distance overrides.

// Keep the .ts extensions. vite.config.ts imports this module, and Vite's
// native config loader strips types via Node, which resolves no extensions —
// so everything reachable from the config needs them. Only typecheck and
// vitest cover the rest of scripts/, and neither fails without them: dropping
// these breaks `vite build` and `pnpm run dev` alone.
import { headerIndex } from './parse/corpus-tsv.ts';
// Type-only: distance/parallax/ reaches back here through its parsers, so a
// value import would close a cycle. Erased at compile.
import type { DistVia } from './distance/parallax/parallax-cascade.ts';

/** Solar-type B-V used as a fallback when no chromaticity input is
 *  available. ~0.65 yields a yellow disc rather than a hot blue or
 *  cold red default. Consumed by stars-parse's AT-HYG read (blank ci
 *  cells) and by star-color-routing-pure's tier-6 fallback. */
export const SOLAR_BV_FALLBACK = 0.65;

// ---- SIMBAD namespace ladder ---------------------------------------------

/** The namespaces every SIMBAD pull is keyed under. This order IS the record
 *  side's walk order — `walkSimbadNamespaces` iterates this array — so
 *  reordering here reorders both SIMBAD joins. Doubles as the build-counts
 *  partition over the SIMBAD tier.
 *
 *  **Ordered by what an identifier names, not by how many keys it holds.** A GJ
 *  number carries its component letter (`Gl 165A`) and so names one star; a TYC
 *  names the Tycho-2 entry, which for a close pair is the system. Where both
 *  reach a row the component-naming one wins, so a system blend never displaces
 *  a component value. This deliberately no longer mirrors the request order
 *  `spine_request_keys` composes with — see `spectral/README.md` § The ladder is
 *  ordered by what an identifier names for why the pull's order is the
 *  load-bearing one. */
export const SIMBAD_NAMESPACE_VALUES = ['source_id', 'hip', 'gj', 'tyc'] as const;
export type SimbadNamespace = (typeof SIMBAD_NAMESPACE_VALUES)[number];

/** The identifiers one record offers a SIMBAD join. `gl` is the raw Gliese
 *  cell from either side — the spine spells that column `gl` and SIMBAD `gj`
 *  — and the ladder folds it itself, so no caller handles the two
 *  spellings. */
export interface SimbadRecordKeys {
  sourceId: string | null;
  hip: number | null;
  tyc: string | null;
  gl: string | null;
}

export interface SimbadNamespaceIndex<T> {
  bySourceId: Map<string, T>;
  byHip: Map<number, T>;
  byTyc: Map<string, T>;
  byGj: Map<string, T>;
}

export function emptySimbadNamespaceIndex<T>(): SimbadNamespaceIndex<T> {
  return {
    bySourceId: new Map(), byHip: new Map(), byTyc: new Map(), byGj: new Map(),
  };
}

/** The designation part of a spine `gl` cell or a SIMBAD `gj` id, folded to
 *  one spelling: `Gl 165A`, `GJ 165A` and `165 A` all yield `165A`. The two
 *  sides spell the same star differently — the spine carries both catalogue
 *  words and SIMBAD stores its own spacing — so both go through this before
 *  they meet. It folds strictly more than `gl_suffix` in
 *  `scripts/refresh/simbad/inputs.py`, which stripped only the catalogue word
 *  when composing the request: inner spacing and case are folded here because
 *  this is where the two spellings actually have to match. */
export function normaliseGjKey(cell: string | null): string | null {
  const text = (cell ?? '').trim();
  if (!text) return null;
  const [word, ...rest] = text.split(' ');
  const suffix = /^(gj|gl)$/i.test(word) ? rest.join(' ') : text;
  const key = suffix.replace(/\s+/g, '').toUpperCase();
  // CNS5 prints whole numbers with a trailing `.0` where every other source
  // writes the bare number, so collapsing it here is what lets an index built
  // over CNS5 and a record's own `gl` cell meet. Only a ZERO fraction is the
  // artifact — the supplement's genuinely fractional entries (`Gl 17.1`) keep
  // theirs (`glieseNumber` in classic-ids/ states the same rule for the label
  // merge, where not collapsing it scored 14 same-star pairs as disagreements).
  const collapsed = key.endsWith('.0') ? key.slice(0, -2) : key;
  return collapsed.length === 0 ? null : collapsed;
}

/** Index and lookup must agree on which HIP cells are keys at all, or a row
 *  indexed under a bogus number becomes unreachable rather than absent. */
export function simbadHipKey(hip: number | null): number | null {
  return hip !== null && Number.isInteger(hip) && hip > 0 ? hip : null;
}

type SimbadNamespaceKey = string | number;

/** `Map` is invariant in its key type, so a `Map<string, T>` is not assignable
 *  to `Map<SimbadNamespaceKey, T>` even though every read and write below stays
 *  inside the concrete key type its own namespace derives. */
function keyedMap<K extends SimbadNamespaceKey, T>(
  map: Map<K, T>,
): Map<SimbadNamespaceKey, T> {
  return map as Map<SimbadNamespaceKey, T>;
}

/** Each namespace's two halves of the join: the key a record offers it, and the
 *  map that namespace's rows live in. Indexing and lookup both read this table
 *  and both iterate `SIMBAD_NAMESPACE_VALUES`, so the order there is the only
 *  statement of walk order, and a key derived for writing cannot diverge from
 *  the one derived to read it back. */
const SIMBAD_NAMESPACE_BINDINGS: {
  readonly [N in SimbadNamespace]: {
    readonly key: (keys: SimbadRecordKeys) => SimbadNamespaceKey | null;
    readonly map: <T>(index: SimbadNamespaceIndex<T>) => Map<SimbadNamespaceKey, T>;
  };
} = {
  source_id: {
    key: (keys) => keys.sourceId || null,
    map: (index) => keyedMap(index.bySourceId),
  },
  hip: {
    key: (keys) => simbadHipKey(keys.hip),
    map: (index) => keyedMap(index.byHip),
  },
  gj: {
    key: (keys) => normaliseGjKey(keys.gl),
    map: (index) => keyedMap(index.byGj),
  },
  tyc: {
    key: (keys) => keys.tyc || null,
    map: (index) => keyedMap(index.byTyc),
  },
};

/** Add one pull row under every namespace it carries; a row carrying none is
 *  joinable by nothing and indexes nowhere. */
export function indexSimbadRow<T>(
  index: SimbadNamespaceIndex<T>,
  keys: SimbadRecordKeys,
  row: T,
  /** Which of two rows sharing one key to index. No key repeats in either
   *  committed pull, so this decides nothing today; it is what a pull that
   *  did emit two rows for one key would merge through instead of failing,
   *  and the consumer that knows which cell it came for is the only thing
   *  able to order them. Returning neither — by throwing — is a valid
   *  verdict for a consumer that cannot. */
  onDuplicate: (
    namespace: SimbadNamespace,
    key: string,
    incumbent: T,
    candidate: T,
  ) => T,
): void {
  for (const namespace of SIMBAD_NAMESPACE_VALUES) {
    const binding = SIMBAD_NAMESPACE_BINDINGS[namespace];
    const key = binding.key(keys);
    if (key === null) continue;
    const map = binding.map(index);
    const incumbent = map.get(key);
    map.set(
      key,
      incumbent === undefined
        ? row
        : onDuplicate(namespace, String(key), incumbent, row),
    );
  }
}

function takeSimbadRow<T, R>(
  row: T | undefined,
  namespace: SimbadNamespace,
  accept: (row: T) => R | null,
): { value: R; namespace: SimbadNamespace } | null {
  if (row === undefined) return null;
  const value = accept(row);
  return value === null ? null : { value, namespace };
}

/** Walk `SIMBAD_NAMESPACE_VALUES` in order — source_id → HIP → GJ → TYC — and
 *  return the first row `accept` takes, with the namespace that found it.
 *  `accept` returning null continues the walk, so a row that exists but carries
 *  nothing usable does not end it — which is why the spectral resolver can fall
 *  past a row whose sp_type will not parse. */
export function walkSimbadNamespaces<T, R>(
  index: SimbadNamespaceIndex<T>,
  keys: SimbadRecordKeys,
  accept: (row: T) => R | null,
): { value: R; namespace: SimbadNamespace } | null {
  for (const namespace of SIMBAD_NAMESPACE_VALUES) {
    const binding = SIMBAD_NAMESPACE_BINDINGS[namespace];
    const key = binding.key(keys);
    if (key === null) continue;
    const hit = takeSimbadRow(binding.map(index).get(key), namespace, accept);
    if (hit) return hit;
  }
  return null;
}

// ---- GCVS variable-star catalogue parsing -------------------------------

// Split pipe-delimited catalogue text into per-line trimmed-cell arrays.
// Blank / whitespace-only lines are skipped; CRLF and LF both accepted.
export function splitPipeDelimited(text: string): string[][] {
  const out: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    out.push(line.split('|').map((f) => f.trim()));
  }
  return out;
}

// GCVS designations in both files are space-padded fixed-width, e.g.
// "R     And *" or "Z     Peg". Trailing asterisk is an indicator we
// don't need; collapse internal whitespace to a single space.
export function normalizeGcvsName(raw: string): string {
  return raw
    .replace(/\*+$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Parse a possibly-annotated GCVS number field: entries may carry "<", ">",
// ":", "()" uncertainty markers or trailing "*"; strip them before parsing.
export function parseGcvsNumber(s: string): number | null {
  const t = s.trim().replace(/[<>():;*]/g, '').trim();
  if (!t) return null;
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

// Per-star variability-type enum. Stored at RECORD_LAYOUT.varType (uint8
// at byte 37); shaders + runtime gate pulsation off this. Tagged with
// 0 = unknown so a build that predates the varType column reads as
// "non-variable" by default without a magic-version bump.
//
// Eclipsing = 2 is the load-bearing value — paired with binaries.bin's
// has_orbit flag, the runtime suppresses GCVS-amplitude pulsation for
// EA/EB/EW stars whose photometric signal now comes from the geometric-
// occlusion field instead.
//
// Codes 0–3 are stable; 4+ refine VAR_TYPE_PULSATING into pulsator
// families so the runtime can drive the per-type radius-swing / colour-
// swing table (docs/science-stellar-modelling.md § Variable-star
// pulsation). VAR_TYPE_PULSATING (1) remains the fallback for a pulsator
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

// SIMBAD's object-type code for a confirmed double/multiple star — the
// otype value that marks a record `unresolved` when nothing resolves.
export const SIMBAD_OTYPE_MULTIPLE = '**';

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

/** Classify a GCVS variability-type column ("EA", "EA/RS", "M", "DCEP",
 *  "RRAB", "SR", "ZAND", "UGSU", ...) into the runtime enum.
 *
 *  Composite types ("EA+RS", "EA/RS", "EA/DM") are classified as
 *  eclipsing whenever the eclipsing-binary prefix appears anywhere in
 *  the string — the geometric-occlusion signal is the real photometric
 *  driver, and superimposing a synthetic intrinsic pulsation on top
 *  would double-count the eclipse depth. */
export function classifyGcvsVarType(rawType: string | null | undefined): number {
  if (!rawType) return VAR_TYPE_UNKNOWN;
  const t = rawType.trim().toUpperCase();
  if (!t) return VAR_TYPE_UNKNOWN;
  // Eclipsing-binary prefixes anywhere in the string. EA / EB / EW are
  // GCVS's three canonical eclipsing classes; ELL is ellipsoidal (no
  // primary minimum, but the modulation is geometric, same suppression
  // logic applies). E* catches the bare "E" form GCVS uses on
  // unclassified eclipsing systems. EP (eclipsing-by-planet) is
  // deliberately NOT here — a transiting-planet host is not a stellar
  // multiple, so it must earn no wings and fall through to VAR_TYPE_OTHER.
  if (/\bE([ABW]|LL)?\b/.test(t)) return VAR_TYPE_ECLIPSING;
  // Intrinsic pulsators, identified by a family prefix at the start of a
  // GCVS type component (split on the composite separators + / |), each
  // mapped to its refined subtype so the runtime can drive the per-type
  // radius/colour-swing table. Only the base family is listed; GCVS's
  // trailing subtype letters ("DCEP"→"DCEPS", "CW"→"CWA/CWB",
  // "RV"→"RVA/RVB", "L"→"LB/LC") are accepted by the tail gate below, so
  // the list never has to enumerate every subtype. Order matters: the
  // longer of two nested families comes first so it wins the `startsWith`
  // ("DCEP"/"BCEP" before "CEP"). "M" and "L" are LAST — a bare single
  // letter would otherwise shadow a longer family sharing that initial.
  //
  // Family → subtype rationale: DCEP/CEP/CW/WVIR are the classical +
  // Type-II Cepheid instability strip; BCEP (β Cep) is a short-period
  // low-amplitude p-mode pulsator, grouped with the DSCT-class low-amp
  // set (DSCT/GDOR/SXPHE/ROAP/SPB/PVTEL/ACYG/ZZ). SR + L are red-giant /
  // supergiant semiregulars; M is the Mira archetype. RV (RV Tauri,
  // ambiguous post-AGB) falls to the generic pulsating default.
  const pulsatorPrefixes: [string, number][] = [
    ['DCEP', VAR_TYPE_CEPHEID], ['BCEP', VAR_TYPE_DSCT], ['CEP', VAR_TYPE_CEPHEID],
    ['DSCT', VAR_TYPE_DSCT], ['GDOR', VAR_TYPE_DSCT], ['SXPHE', VAR_TYPE_DSCT],
    ['PVTEL', VAR_TYPE_DSCT], ['ACYG', VAR_TYPE_DSCT], ['ROAP', VAR_TYPE_DSCT],
    ['WVIR', VAR_TYPE_CEPHEID], ['CW', VAR_TYPE_CEPHEID],
    ['RR', VAR_TYPE_RR_LYRAE], ['RV', VAR_TYPE_PULSATING],
    ['SPB', VAR_TYPE_DSCT],
    ['SR', VAR_TYPE_SEMIREGULAR],
    ['ZZ', VAR_TYPE_DSCT],
    ['M', VAR_TYPE_MIRA], ['L', VAR_TYPE_SEMIREGULAR],
  ];
  for (const part of t.split(/[+/|]/)) {
    const p = part.trim();
    if (!p) continue;
    for (const [pre, subtype] of pulsatorPrefixes) {
      if (p.startsWith(pre)) {
        // The tail after the family prefix must be a GCVS subtype
        // continuation: trailing subtype letters, a digit, a paren, or
        // end-of-string. No non-pulsator GCVS code shares a pulsator
        // family's prefix, so a letter tail is always a subtype — never
        // a coincidental longer word. A non-matching tail falls through
        // to the next prefix.
        const tail = p.slice(pre.length);
        if (tail === '' || /^[A-Z0-9()/.]/.test(tail)) return subtype;
      }
    }
  }
  // Anything GCVS classifies that isn't eclipsing or a pulsator —
  // cataclysmic (UG*, ZAND), eruptive (FU, GCAS, IN*), rotating
  // (ACV, BY, RS, ELL, FKCOM), X-ray binaries (X*) — falls through
  // here. The shader's pulsation gate doesn't fire on these (varType
  // != ECLIPSING), so they keep their GCVS-amplitude modulation as
  // before. The category exists primarily for hover-tooltip
  // disambiguation and future per-type rendering.
  return VAR_TYPE_OTHER;
}

/** True when GCVS "EP" (eclipsing-by-planet) is the star's SOLE
 *  variability class. A transiting-planet host has no intrinsic
 *  variability (the dip is extrinsic occlusion by a planet) and is not
 *  a stellar multiple, so it earns neither a variable ring/pulse nor
 *  multi-star wings — the cross-match drops it entirely. A superimposed
 *  intrinsic pulsator ("EP+DSCT") classifies as that pulsator and keeps
 *  its ring, so it returns false here. */
export function isPlanetaryTransitOnly(rawType: string | null | undefined): boolean {
  if (!rawType) return false;
  if (!/\bEP\b/.test(rawType.trim().toUpperCase())) return false;
  return classifyGcvsVarType(rawType) === VAR_TYPE_OTHER;
}

// ---- Binary catalog format ----------------------------------------------

// Single source of truth for the catalog.bin file layout, shared by the
// writer (scripts/catalog/build-catalog), the runtime reader
// (src/client/loaders/catalog-loader), and the verify tool
// (scripts/catalog/validate/verify-catalog).
//
// File structure:
//   [0,                       HEADER_SIZE)                              header
//   [HEADER_SIZE,             HEADER_SIZE + count*RECORD_SIZE)          records
//   [HEADER_SIZE + count*RECORD_SIZE,                       end)        name table
//
// HEADER_LAYOUT / RECORD_LAYOUT below carry the per-field byte offsets;
// HEADER_FIELD_KINDS / RECORD_FIELD_KINDS carry the matching wire types
// (byte widths derive from the kind). Adding/changing a field means: bump
// BINARY_VERSION + MAGIC, extend the LAYOUT + KINDS pair with the new
// offset and kind, and the writer + reader + tests pick the change up
// automatically.

export const MAGIC = 'HYG9';
export const BINARY_VERSION = 9;
export const HEADER_SIZE = 32;
export const RECORD_SIZE = 100;
// Bytes 97..99 are reserved (zero-filled): the v9 multiplicityStatus uint8
// lands at 96 and the stride stays a multiple of 4. A future field taking a
// reserved byte still needs a BINARY_VERSION bump — readers must know the
// byte is populated.
export const RECORD_RESERVED_TAIL_BYTES = 3;
export const NO_COMPANION = 0xffffffff;
// Reserved none/invalid SID sentinel (docs/sid.md § 2); allocation starts
// at 1, so 0 in RECORD_LAYOUT.sid means the record resolved to no ledger
// row — a state build-catalog.ts writes only in its unallocated-bootstrap
// path before hard-failing (scripts/catalog/README.md § SID allocation).
export const NO_SID = 0;
// Sentinel uint8 stored at RECORD_LAYOUT.conIndex when the star has no
// constellation assignment. Valid IAU constellation indexes are
// 0..87 (88 modern constellations); 255 is unambiguous.
export const NO_CONSTELLATION_INDEX = 0xff;
// Sentinel uint64 stored at RECORD_LAYOUT.gaiaSourceId when AT-HYG's
// `gaia` column is blank. Valid Gaia DR3 source_ids are positive 63-bit
// integers, so 0 is unambiguous.
export const NO_GAIA_SOURCE_ID = 0n;
// Float32 NaN is the null sentinel for the seven Gaia DR3 Apsis fields
// (teff/logg/[M/H]/A0 from gspphot ∪ gspspec). NaN survives IEEE-754
// round-trip through DataView.setFloat32/getFloat32 and never collides
// with a physical value — Teff > 0, logg > 0, A0 ≥ 0, [M/H] is finite.
// Consumers test with `Number.isNaN(x)`.
export const NO_APSIS = NaN;

// On-disk transport chunking — the single reassembly contract shared by the
// writer, client loader, and Node reader. See scripts/catalog/README.md
// § On-disk transport chunking.

export const CATALOG_MANIFEST_FILENAME = 'catalog-manifest.json';

// 16 MiB keeps every chunk clear of the 25 MiB Workers ceiling with growth
// headroom — do not raise toward 25 or a fuller catalog breaks deploy.
export const CATALOG_CHUNK_TARGET_BYTES = 16 * 1024 * 1024;

export interface CatalogManifest {
  /** Byte length of each chunk in `catalog.bin.<i>` order. */
  chunkBytes: number[];
  /** Sum of chunkBytes — assembled length, for pre-alloc + integrity check. */
  totalBytes: number;
  /** Retired-sid → successor-sid pairs (docs/sid.md § 9.4). Omitted when
   *  no effectively-retired sid carries a successor (merge-type
   *  retirements only exist after a DR reconciliation). */
  sidSuccessors?: [number, number][];
}

export function catalogChunkFilename(index: number): string {
  return `catalog.bin.${index}`;
}

/** Split a total byte length into sequential per-chunk lengths, each
 *  ≤ targetBytes. A zero-length buffer yields one empty chunk so the
 *  manifest always carries ≥1 entry. */
export function planCatalogChunks(
  totalBytes: number,
  targetBytes: number = CATALOG_CHUNK_TARGET_BYTES,
): number[] {
  if (targetBytes <= 0) throw new Error(`Invalid chunk target: ${targetBytes}`);
  if (totalBytes <= 0) return [0];
  const chunkBytes: number[] = [];
  for (let off = 0; off < totalBytes; off += targetBytes) {
    chunkBytes.push(Math.min(targetBytes, totalBytes - off));
  }
  return chunkBytes;
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
  sid: 80,          // Stellata ID (0 = NO_SID; docs/sid.md § 7)
  // Space-motion velocity, equatorial Cartesian pc/yr (Sol at origin).
  // Consumed once at load by the epoch-advance pass; positions stay at
  // the fixed J2016.0 scene epoch on disk. See scripts/catalog/parse/README.md
  // § Space-motion velocity and docs/science-catalog-ingestion.md
  // § Current-epoch star positions.
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

/** Encode the fixed-size header — the writer side shared with the loader
 *  round-trip tests. Reserved bytes (20..31) stay zero. */
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

/** Read one field of the record starting at `recordOff` — the reader side
 *  of the layout contract, shared by the SoA runtime loader
 *  (src/client/loaders/catalog-loader.ts) and the AoS Node reader
 *  (catalog-lookup.ts). The `view.get*` call is chosen from
 *  RECORD_FIELD_KINDS, so a field's declared wire type and the bytes a
 *  reader actually pulls can never disagree. */
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

/** Numeric sinks a decoded column can land in. */
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

/** Decode one field across all `count` records into a parallel array — the
 *  bulk counterpart of `readRecordField` for the SoA runtime loader.
 *  Column-at-a-time (one kind dispatch per column, then a tight
 *  constant-getter loop) decodes the 380k-record catalog measurably faster
 *  than a per-record pass over every field. */
export function decodeRecordColumn(
  view: DataView,
  count: number,
  field: NumericRecordField,
  out: RecordColumnSink,
  { stride = 1, component = 0, scale = 1 }: DecodeRecordColumnOptions = {},
): void {
  const base = HEADER_SIZE + RECORD_LAYOUT[field];
  const kind: FieldKind = RECORD_FIELD_KINDS[field];
  switch (kind) {
    case 'f32':
      for (let i = 0; i < count; i++) {
        out[i * stride + component] = view.getFloat32(base + i * RECORD_SIZE, true) * scale;
      }
      return;
    case 'u8':
      for (let i = 0; i < count; i++) {
        out[i * stride + component] = view.getUint8(base + i * RECORD_SIZE) * scale;
      }
      return;
    case 'u16':
      for (let i = 0; i < count; i++) {
        out[i * stride + component] = view.getUint16(base + i * RECORD_SIZE, true) * scale;
      }
      return;
    case 'u32':
      for (let i = 0; i < count; i++) {
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
  count: number,
  field: BigRecordField,
  out: BigUint64Array,
): void {
  const base = HEADER_SIZE + RECORD_LAYOUT[field];
  for (let i = 0; i < count; i++) {
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

// Name table layout: two zero bytes of padding so name offset 0 reads as
// the "no name" sentinel, followed by length-prefixed UTF-8 strings:
// uint16 byteLen, then byteLen bytes.
export const NAME_TABLE_PADDING = 2;
export const NAME_LENGTH_PREFIX_BYTES = 2;

/** Decode the name table into `nameOffset` → name, keyed by the offset
 *  RECORD_LAYOUT.nameOffset stores (relative to the table start). The
 *  reader side of the writer's table emit, shared by both readers. */
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
   *  build used (docs/star-naming.md § 6). */
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
  // (classic-ids/README.md § The label merge). Search resolves them; the
  // dropdown label stays the record's own designation.
  hda?: number[];
  hra?: number[];
  gl?: string;   // Gliese / GJ designation
  cl?: string;   // multiple-star component letter (A/B/C/Ab…) — see search.ts
  cp?: number;   // WDS root anchor's record index; base for "<designation> <cl>"
  /** Published spellings that resolve a search and never display — a name
   *  the ladder displaced, or an approved alternate. Strings no structure
   *  implies; every derivable spelling is derived (docs/star-naming.md § 5). */
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
  desigConIndex: number;
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
 *  Entries arrive brightest-first (the absmag sort fixes record order), so an
 *  ambiguous designation resolves to the brightest record carrying it — 57 HD
 *  and 11 HR numbers are displayed by two records each, always a component pair
 *  sharing one catalogue number. And an alias never displaces a record that
 *  displays that number outright, whichever way the absmag sort happened to
 *  order the two. `classic-ids/README.md` § An alias stops at the blend is the
 *  same rule on the write side; `cns5AstrometryByGj` is the same two-pass
 *  reduction over CNS5's component letters.
 *
 *  Many keys onto one record, never one key onto several: the direction the
 *  dropdown reads — record to label — stays single-valued. */
export function buildAliasedIdIndex<K>(
  entries: readonly SearchEntry[],
  displayed: (e: SearchEntry) => K | undefined,
  aliases: (e: SearchEntry) => readonly K[] | undefined,
): Map<K, number> {
  const out = new Map<K, number>();
  for (const entry of entries) {
    const key = displayed(entry);
    if (key !== undefined && !out.has(key)) out.set(key, entry.i);
  }
  for (const entry of entries) {
    for (const key of aliases(entry) ?? []) {
      if (!out.has(key)) out.set(key, entry.i);
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
  if (hasConRelativeDesignation
      && s.desigConIndex !== NO_CONSTELLATION_INDEX
      && s.desigConIndex !== s.conIndex) {
    entry.dc = s.desigConIndex;
  }
  return entry;
}

// ---- Catalog flag bits --------------------------------------------------

// Per-star bitfield stored at RECORD_LAYOUT.flags. Single source of truth
// for both writers (scripts/catalog/build-catalog, scripts/catalog/catalog-pure
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
   *  table. See companions/README.md § Companion promotion from
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
 *  pins Sol's radius at 1.035 R☉ against it). The IAU 2015 Resolution B2
 *  nominal value is 4.83; adopting it is a deliberate recalibration, not a
 *  drift fix, and moves the pinned radius. */
export const SOL_ABSOLUTE_V_MAGNITUDE = 4.85;

/** Sol's apparent V, curated for the same reason its direction is: it carries
 *  no identifier any cascade can key on, so every machine tier misses it and
 *  V is a membership gate. Cox 2000, *Allen's Astrophysical Quantities* 4th
 *  ed. § 12 — the published value, not the printed cell the retired
 *  AT-HYG-driven build happened to carry.
 *
 *  It reaches no shipped byte: absmag takes `SOL_ABSOLUTE_V_MAGNITUDE` above
 *  rather than deriving from this, because Sol sits at distance zero. */
export const SOL_APPARENT_V_MAGNITUDE = -26.74;

/** Bits intentionally left free for future use — adding functionality
 *  that fits inside one of these does not require a BINARY_VERSION bump.
 *  The reservation is pinned by a regression test: drifting RESERVED into
 *  any FLAGS value forces a deliberate edit here. */
export const RESERVED_FLAG_BITS = 0x40 | 0x80;

// ---- Geometric binary inference -----------------------------------------

// Pairs within this 3D distance are flagged as a physical binary/multiple
// system. 0.005 pc ≈ 1030 AU — wide-binary territory. Gaia resolves most
// bound pairs wider than ~0.5 arcsec so this captures the visually-
// renderable cases.
export const BINARY_MAX_SEP_PC = 0.005;

// Structural type of a star record consumed by `inferBinaries`. The build
// script's full Star type extends this; the helper only reads/writes the
// fields named here.
export interface BinaryStar {
  x: number;
  y: number;
  z: number;
  absmag: number;
  flags: number;
  companionIdx: number;
}

// Index of the brightest (lowest absmag) star in `indices`, or -1 when
// empty. Single point of truth for the "primary = brightest of group"
// convention shared by every binary-flagging path (geometric mutual pairs
// in inferBinaries; CCDM groups + curated doubles in applyDoublesFlag).
export function pickBrightest(
  stars: Pick<BinaryStar, 'absmag'>[],
  indices: number[],
): number {
  let bestIdx = -1;
  let bestMag = Infinity;
  for (const i of indices) {
    const m = stars[i].absmag;
    if (m < bestMag) {
      bestMag = m;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// Pick the brightest star of `indices` and OR FLAG_BINARY_PRIMARY onto it.
// Returns the picked index, or -1 if the group is empty.
//
// Idempotent: re-running on a group whose primary is already flagged
// produces the same flag bits.
export function markPrimary(
  stars: Pick<BinaryStar, 'absmag' | 'flags'>[],
  indices: number[],
): number {
  const bestIdx = pickBrightest(stars, indices);
  if (bestIdx === -1) return -1;
  stars[bestIdx].flags |= FLAG_BINARY_PRIMARY;
  return bestIdx;
}

// Vetoes a freshly-picked primary before its FLAG_BINARY_PRIMARY bit is
// set — the CCDM optical-double gate (see isOpticalDoublePrimary).
export type SuppressPredicate = (
  primaryIdx: number,
  memberIndices: number[],
) => boolean;

// Like markPrimary, but a no-op when any star in `indices` already carries
// FLAG_BINARY_PRIMARY. Used by the CCDM pass: a star flagged by
// inferBinaries' mutual-pair pick should not get re-picked here, since
// the two passes can disagree on which of a triple is "primary" (e.g. a
// non-mutual {A, B, C} where the geometric pair is (B, C) but A is
// brightest in the CCDM group). Honouring the existing pick keeps the
// "at most one primary per physical system" contract — re-flagging would
// produce two wings glyphs for the same system.
//
// `suppress`, when supplied, vetoes the fresh flag after the primary is
// picked but before the bit is set (the CCDM optical-double gate). The
// already-flagged short-circuit runs first, so a primary the geometric
// pass already winged is never subject to suppression.
//
// Returns the picked index, -1 if no in-catalog members, -2 if a member
// was already flagged, or -3 if `suppress` vetoed the pick.
export function markPrimaryIfUnflagged(
  stars: Pick<BinaryStar, 'absmag' | 'flags'>[],
  indices: number[],
  suppress?: SuppressPredicate,
): number {
  if (indices.length === 0) return -1;
  for (const i of indices) {
    if ((stars[i].flags & FLAG_BINARY_PRIMARY) !== 0) return -2;
  }
  const bestIdx = pickBrightest(stars, indices);
  if (bestIdx === -1) return -1;
  if (suppress?.(bestIdx, indices)) return -3;
  stars[bestIdx].flags |= FLAG_BINARY_PRIMARY;
  return bestIdx;
}

// Apply FLAG_BINARY_PRIMARY across an iterable of HIP-indexed groups. Each
// group's brightest in-catalog component (lowest absmag) gets the bit,
// idempotent with any pre-existing flags from `inferBinaries` (the
// geometric mutual-pair pass can have already marked one member). Groups
// with no in-catalog members are silently skipped.
//
// The `groups` iterable is the union of CCDM groups parsed from the
// Hipparcos cross-reference and the curated `KNOWN_VISUAL_DOUBLES`
// overrides — the caller (build-catalog) constructs the union; this
// helper just walks it.
//
// `suppress` (optional) is forwarded to `markPrimaryIfUnflagged` to veto
// optical doubles — see isOpticalDoublePrimary.
//
// Returns:
//   systems     — count of groups that resolved at least one in-catalog HIP.
//   flagged     — count of groups where this pass set a fresh primary
//                 (i.e. excludes groups whose primary was already set by a
//                 prior pass).
//   suppressed  — count of groups whose fresh primary was vetoed as an
//                 optical double.
//
// Mutates `stars[i].flags` in place via `markPrimaryIfUnflagged`. Pure
// otherwise — does not read or write any other fields.
export interface DoublesStar { absmag: number; flags: number; hip: number | null; }

// HIP → record-index lookup over a star list. When the same HIP appears
// on multiple rows (rare; binary companions sharing an identifier), the
// FIRST occurrence wins via the `!has` check — so against the
// absmag-sorted star array build-catalog.ts produces, the value is the
// brightest row. Shared between the constellation stick-figure resolver
// and the CCDM doubles pass so the two never disagree on a duplicate.
export function buildHipToIndex(
  stars: { hip: number | null }[],
): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < stars.length; i++) {
    const h = stars[i].hip;
    if (h !== null && h > 0 && !m.has(h)) m.set(h, i);
  }
  return m;
}

export function applyDoublesFlag(
  stars: DoublesStar[],
  groups: Iterable<Iterable<number>>,
  hipToIndex: Map<number, number>,
  suppress?: SuppressPredicate,
): { systems: number; flagged: number; suppressed: number } {
  let systems = 0;
  let flagged = 0;
  let suppressed = 0;
  for (const hips of groups) {
    const indices: number[] = [];
    for (const h of hips) {
      const idx = hipToIndex.get(h);
      if (idx !== undefined) indices.push(idx);
    }
    if (indices.length === 0) continue;
    systems++;
    const picked = markPrimaryIfUnflagged(stars, indices, suppress);
    if (picked >= 0) flagged++;
    else if (picked === -3) suppressed++;
  }
  return { systems, flagged, suppressed };
}

// ---- CCDM optical-double suppression ------------------------------------

// Bound stellar pairs sit within the Galactic tidal-disruption limit for
// field binaries (~1 pc); a wider 3D split is a line-of-sight optical
// double. Mirrors the binaries pipeline's Stage-5 SEPARATION_LIMIT_PC.
export const OPTICAL_DOUBLE_MIN_SEP_PC = 1.0;

// Fields isOpticalDoublePrimary reads. Star satisfies this structurally.
/** Whether a record's distance rests on a Gaia parallax, raw or through the
 *  Bailer-Jones posterior over it. The optical-double suppression needs it
 *  because a separation is only trustworthy when both stars' distances are: a
 *  Hipparcos or courier parallax carries error bars wide enough to put a bound
 *  pair kiloparsecs apart, which reads as an optical double. */
export function hasGaiaQualityDistance(distVia: DistVia | null): boolean {
  return distVia === 'gaia_dr3_inversion' || distVia === 'bailer_jones';
}

export interface OpticalDoubleStar {
  absmag: number;
  x: number;
  y: number;
  z: number;
  hip: number | null;
  gaiaSourceId: string | null;
  /** The tier this record's own distance came from — see `hasGaiaQualityDistance`.
   *  Was the spine's editorial `dist_src` cell until the parallax cascade gave
   *  the build a first-hand answer to the same question. */
  distVia: DistVia | null;
  varType: number;
}

export interface OpticalDoubleContext {
  // HIPs / Gaia source_ids that are a component of a kept physical pair in
  // data/binaries/multiples.tsv (Stage 5 classified them bound), unioned
  // with the curated KNOWN_VISUAL_DOUBLES. A primary in either set has
  // independent physical evidence — its wings stand regardless of CCDM
  // group geometry.
  physicalHips: ReadonlySet<number>;
  physicalGaia: ReadonlySet<string>;
  minSepPc: number;
}

// True when a CCDM group's picked primary should NOT be winged: it's an
// optical double with no independent physical evidence. See
// scripts/catalog/multiplicity/README.md § CCDM double-star cross-match.
//
// Suppression fires only on positive evidence the asserted pair is optical
// — the nearest same-group sibling with a Gaia-quality distance sits
// farther than ctx.minSepPc in 3D. It never fires on mere absence of
// physical evidence, so a noisy parallax can't strip real wings. Keeps the
// wings (returns false) when any holds:
//  - the primary is a component of a kept physical pair, or eclipsing
//    (extrinsic wings earned) — the geometric mutual-pair flag is honoured
//    upstream by markPrimaryIfUnflagged's already-flagged short-circuit;
//  - the primary lacks a Gaia-quality distance (separation untrustworthy);
//  - no same-group sibling with a Gaia-quality distance exists to measure.
export function isOpticalDoublePrimary(
  primaryIdx: number,
  memberIndices: number[],
  stars: OpticalDoubleStar[],
  ctx: OpticalDoubleContext,
): boolean {
  const p = stars[primaryIdx];
  if (p.varType === VAR_TYPE_ECLIPSING) return false;
  if (p.hip !== null && ctx.physicalHips.has(p.hip)) return false;
  if (p.gaiaSourceId !== null && ctx.physicalGaia.has(p.gaiaSourceId)) return false;
  if (!hasGaiaQualityDistance(p.distVia)) return false;

  let nearestSq = Infinity;
  for (const j of memberIndices) {
    if (j === primaryIdx) continue;
    const q = stars[j];
    if (!hasGaiaQualityDistance(q.distVia)) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dz = q.z - p.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < nearestSq) nearestSq = d2;
  }
  if (nearestSq === Infinity) return false;
  return nearestSq > ctx.minSepPc * ctx.minSepPc;
}

// Spatial-grid nearest-neighbour pass. For each star, find its nearest
// neighbour within BINARY_MAX_SEP_PC and record it as `companionIdx`.
// `companionIdx` is the **directed** nearest neighbour (A's nearest may
// be B while B's nearest is some third star C); the renderer reads it
// as "the partner for SVG disc-mask cutouts and chart-mode wings,"
// which is well-defined even when the relationship is one-way.
//
// The `0x10` flag is stricter: set only on the brighter member of a
// **mutual** pair (A's nearest is B AND B's nearest is A). The chart-
// mode wings glyph is anchored on `0x10`, so mutual-only avoids
// over-flagging in dense clusters where one star's nearest happens to
// be a third star that's actually paired with someone else.
//
// Mutates `stars[i].companionIdx` and `stars[i].flags` in place.
// Returns counts for the build-time log line:
//   pairs        — total directed companion assignments
//   mutualPairs  — undirected mutual pairs (each counted once); also
//                  equals the count of FLAG_BINARY_PRIMARY bits set,
//                  since we mark exactly one primary per mutual pair
export function inferBinaries(
  stars: BinaryStar[],
): { pairs: number; mutualPairs: number } {
  const cell = BINARY_MAX_SEP_PC;
  const cellInv = 1 / cell;
  const grid = new Map<number, number[]>();
  const n = stars.length;

  const hashKey = (ix: number, iy: number, iz: number): number =>
    ix * 73856093 + iy * 19349663 + iz * 83492791;

  for (let i = 0; i < n; i++) {
    const s = stars[i];
    const ix = Math.floor(s.x * cellInv);
    const iy = Math.floor(s.y * cellInv);
    const iz = Math.floor(s.z * cellInv);
    const key = hashKey(ix, iy, iz);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  const sepSq = BINARY_MAX_SEP_PC * BINARY_MAX_SEP_PC;
  let pairs = 0;

  for (let i = 0; i < n; i++) {
    const s = stars[i];
    const ix = Math.floor(s.x * cellInv);
    const iy = Math.floor(s.y * cellInv);
    const iz = Math.floor(s.z * cellInv);
    let bestIdx = -1;
    let bestSq = sepSq;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(hashKey(ix + dx, iy + dy, iz + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i) continue;
            const t = stars[j];
            const dxv = t.x - s.x;
            const dyv = t.y - s.y;
            const dzv = t.z - s.z;
            const d2 = dxv * dxv + dyv * dyv + dzv * dzv;
            if (d2 < bestSq) {
              bestSq = d2;
              bestIdx = j;
            }
          }
        }
      }
    }
    if (bestIdx !== -1) {
      stars[i].companionIdx = bestIdx;
      pairs++;
    }
  }

  // Second pass: identify mutual pairs (A↔B where each is the other's
  // directed nearest) and flag the brighter member as primary. Iterate
  // i < j to count each pair exactly once.
  let mutualPairs = 0;
  for (let i = 0; i < n; i++) {
    const j = stars[i].companionIdx;
    if (j < 0 || j <= i) continue;
    if (stars[j].companionIdx !== i) continue;
    mutualPairs++;
    markPrimary(stars, [i, j]);
  }

  return { pairs, mutualPairs };
}

// ---- Bailer-Jones (DR3) distance override -------------------------------

/** Whether a record is eligible for the Bailer-Jones override: it resolves to a
 *  Gaia DR3 source_id AND the parallax its own cascade settled on is Gaia's.
 *
 *  B-J publishes a Bayesian posterior over a Gaia parallax, so it may only
 *  supersede that same parallax. Applied to a record whose distance rests on
 *  Hipparcos, CNS5 or Gliese instead, it would discard a measurement and
 *  substitute a posterior computed from a different, worse one — which is how
 *  the override originally shipped without a filter and moved ~11 stars onto the
 *  Galactic-density prior tail at ~10–40 kpc.
 *
 *  This used to gate on the spine's `dist_src` cell, an AT-HYG editorial value
 *  standing in for the question. `docs/catalog-driver.md` § 5 forbids that: the
 *  build now resolves the parallax first-hand, so the tier IS the predicate. */
export function isBailerJonesEligible(
  gaiaSourceId: string | null,
  distVia: DistVia,
): boolean {
  return !!gaiaSourceId && distVia === 'gaia_dr3_inversion';
}

/** Parse a Gaia DR3 source_id cell into a decimal string suitable for
 *  `BigInt()`. Returns null for blank cells AND for cells that aren't
 *  pure decimal digits — guards the build's `BigInt(s.gaiaSourceId)`
 *  call against a malformed AT-HYG row throwing a SyntaxError mid-write.
 *  Same `/^\d+$/` shape gate as `parseGaiaHipXmatchTsv` in `gaia-xmatch.ts`. */
export function parseGaiaSourceIdStr(s: string | undefined | null): string | null {
  if (s === undefined || s === null) return null;
  const t = s.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return null;
  return t;
}

/** Magnitude-consistency gate for Gaia source bindings, shared with the
 *  binaries pipeline: keep equal to GAIA_BINDING_G_MINUS_V_REJECT_MAG in
 *  scripts/binaries/indices.py (catalog-pure.test.ts cross-checks the
 *  Python source text). A bound source more than this much fainter in G
 *  than the star's V is not the star — Gaia's fit fails on saturated
 *  bright stars, so both AT-HYG's `gaia` cell and the
 *  hipparcos2_best_neighbour cross-walk can land on a resolvable
 *  companion or background star instead (Toliman → a G=20.95 source,
 *  Castor → Castor B's source). */
export const GAIA_BINDING_G_MINUS_V_REJECT_MAG = 1.0;

/** One (wds_id, component) attribution parsed from
 *  data/simbad/simbad_wds_xids.tsv. */
export interface WdsComponentAttribution {
  wdsId: string;
  component: string;
}

/** SIMBAD WDS cross-IDs indexed for the sibling-letter gate below.
 *  One source or HIP can carry several attributions (blended sources,
 *  blend-suffixed HIPs, multi-system membership), so values are arrays.
 *  `primarySourceLetterByWds` is each system's lexicographically-first
 *  component letter among those carrying their own Gaia source — the
 *  letter a system-level (blend-HIP) AT-HYG row should key on. */
export interface SimbadWdsXidIndex {
  bySource: Map<string, WdsComponentAttribution[]>;
  byHip: Map<number, WdsComponentAttribution[]>;
  primarySourceLetterByWds: Map<string, string>;
}

/** Parse data/simbad/simbad_wds_xids.tsv (refresh-simbad-wds-xids.py)
 *  into per-source and per-HIP WDS-component attribution maps. Source
 *  ids stay strings — they exceed Number.MAX_SAFE_INTEGER. */
export function parseSimbadWdsXidsTsv(text: string): SimbadWdsXidIndex {
  const bySource = new Map<string, WdsComponentAttribution[]>();
  const byHip = new Map<number, WdsComponentAttribution[]>();
  const primarySourceLetterByWds = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  const idx = headerIndex(
    lines[0] ?? '',
    ['wds_id', 'component', 'gaia_source_id', 'hip'],
    'SIMBAD WDS xids TSV',
    'Re-run scripts/refresh/refresh-simbad-wds-xids.py.',
  );
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const wdsId = (cells[idx.wds_id] ?? '').trim();
    const component = (cells[idx.component] ?? '').trim();
    if (!wdsId || !component) continue;
    const attr: WdsComponentAttribution = { wdsId, component };
    const src = parseGaiaSourceIdStr(cells[idx.gaia_source_id]);
    if (src) {
      const list = bySource.get(src);
      if (list) list.push(attr);
      else bySource.set(src, [attr]);
      const p = primarySourceLetterByWds.get(wdsId);
      if (p === undefined || component < p) {
        primarySourceLetterByWds.set(wdsId, component);
      }
    }
    const hip = parseInt((cells[idx.hip] ?? '').trim(), 10);
    if (Number.isFinite(hip) && hip > 0) {
      const list = byHip.get(hip);
      if (list) list.push(attr);
      else byHip.set(hip, [attr]);
    }
  }
  return { bySource, byHip, primarySourceLetterByWds };
}

/** 'A' vs 'B' are disjoint siblings; 'A' vs 'Aa' are one lineage (the
 *  sub-letter carries the parent's light), so only a non-prefix-related
 *  pair counts as a different star. */
function wdsComponentsDisjoint(a: string, b: string): boolean {
  return !a.startsWith(b) && !b.startsWith(a);
}

/** Sibling-letter attribution gate — the catalog-boundary mirror of the
 *  binaries pipeline's identity refutation (stage2_resolve.py): true
 *  when SIMBAD's WDS cross-IDs give one component letter sole ownership
 *  of `sourceId` while the row's own identity points at a different
 *  letter of the same system. Gaia's HIP best-neighbour cross-walk (and
 *  AT-HYG's `gaia` cell, which ingests it) lands a saturated primary's
 *  HIP on the resolvable sibling's source when both are similar
 *  brightness, so the G−V gate misses it (HIP 83608 = μ Dra A carries
 *  μ Dra B's source; HIP 41098 carries HD 70492 B's).
 *
 *  Per system where `sourceId` is attributed to exactly one letter X:
 *  - the row's HIP attributed only to letters compatible with X (same
 *    lineage) → the row IS X; cleared.
 *  - attributed only to letters disjoint from X → the row is a
 *    different star; scrubbed.
 *  - attributed to both (blend-suffixed `HIP nA`/`HIP nB`), or absent
 *    from the system's per-component xids (Hipparcos blend entries live
 *    on SIMBAD system-level objects) → the AT-HYG row is the system
 *    record and must key on the primary lineage: scrubbed when the
 *    system's source-bearing primary letter is disjoint from X. */
export function isSiblingLetterAttribution(
  sourceId: string,
  hip: number | null,
  xids: SimbadWdsXidIndex | null,
): boolean {
  if (hip === null || xids === null) return false;
  const srcAttrs = xids.bySource.get(sourceId);
  if (!srcAttrs) return false;
  const hipAttrs = xids.byHip.get(hip) ?? [];
  for (const wdsId of new Set(srcAttrs.map((a) => a.wdsId))) {
    const sLetters = new Set(
      srcAttrs.filter((a) => a.wdsId === wdsId).map((a) => a.component),
    );
    if (sLetters.size !== 1) continue; // photocentre blend — no sole owner
    const x = [...sLetters][0];
    const hLetters = hipAttrs
      .filter((a) => a.wdsId === wdsId)
      .map((a) => a.component);
    if (hLetters.length > 0) {
      const anyRelated = hLetters.some((l) => !wdsComponentsDisjoint(l, x));
      const anyDisjoint = hLetters.some((l) => wdsComponentsDisjoint(l, x));
      if (anyRelated && !anyDisjoint) continue;
      if (anyDisjoint && !anyRelated) return true;
    }
    const p = xids.primarySourceLetterByWds.get(wdsId);
    if (p !== undefined && wdsComponentsDisjoint(p, x)) return true;
  }
  return false;
}

/** Resolve an AT-HYG row's Gaia DR3 source_id, falling back to a
 *  HIP→Gaia cross-walk when the AT-HYG `gaia` column is blank.
 *  Precedence: AT-HYG native > HIP cross-walk; returns null when
 *  neither source has a hit. Gaia-saturated bright binaries (Sirius,
 *  Vega, Procyon, Polaris, Betelgeuse, …) are absent from BOTH
 *  AT-HYG.gaia AND Gaia's `hipparcos2_best_neighbour` cross-walk for
 *  the same physical reason (Gaia's 5-parameter fit fails on
 *  saturated sources), and therefore remain null here. They are
 *  resolved instead through the build-binaries.py pipeline writing
 *  data/binaries/multiples.tsv.
 *
 *  When `vMag` and `gMagOf` are supplied, each candidate binding is
 *  vetted against the magnitude gate above; when `wdsXids` is supplied,
 *  each is also vetted against the sibling-letter gate. A rejected
 *  native cell still falls through to the cross-walk (itself vetted).
 *  `magRejected` / `siblingRejected` report that at least one candidate
 *  was scrubbed by the respective gate. */
export function resolveGaiaSourceId(
  gaiaSourceId: string | null,
  hip: number | null,
  hipToGaia: Map<number, string> | null,
  vMag: number | null = null,
  gMagOf: ((sourceId: string) => number | null) | null = null,
  wdsXids: SimbadWdsXidIndex | null = null,
): {
  gaiaSourceId: string | null;
  backfilled: boolean;
  magRejected: boolean;
  siblingRejected: boolean;
} {
  let magRejected = false;
  let siblingRejected = false;
  const passes = (id: string): boolean => {
    if (vMag !== null && gMagOf !== null) {
      const g = gMagOf(id);
      if (g !== null && g - vMag > GAIA_BINDING_G_MINUS_V_REJECT_MAG) {
        magRejected = true;
        return false;
      }
    }
    if (isSiblingLetterAttribution(id, hip, wdsXids)) {
      siblingRejected = true;
      return false;
    }
    return true;
  };
  if (gaiaSourceId && passes(gaiaSourceId)) {
    return { gaiaSourceId, backfilled: false, magRejected, siblingRejected };
  }
  if (hip === null || hip <= 0 || !hipToGaia) {
    return { gaiaSourceId: null, backfilled: false, magRejected, siblingRejected };
  }
  const hit = hipToGaia.get(hip);
  if (hit && passes(hit)) {
    return { gaiaSourceId: hit, backfilled: true, magRejected, siblingRejected };
  }
  return { gaiaSourceId: null, backfilled: false, magRejected, siblingRejected };
}

/** Parse the TSV produced by `scripts/refresh/refresh-bailer-jones.py` into a
 *  Gaia DR3 source_id → distance (pc) map. `source_id` is kept as a
 *  string: Gaia source_ids exceed `Number.MAX_SAFE_INTEGER`, so any
 *  numeric parse would silently corrupt the join key.
 *
 *  Per Bailer-Jones 2021, `r_med_photogeo` is preferred when available
 *  (combines the parallax likelihood with a colour-and-magnitude
 *  population prior); `r_med_geo` is the geometric-only fallback for
 *  rows without photogeo (no usable G or BP–RP). */
export function parseBailerJonesTsv(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  const idx = headerIndex(
    lines[0] ?? '',
    ['source_id', 'r_med_geo', 'r_med_photogeo'],
    'Bailer-Jones TSV',
    'Re-run scripts/refresh/refresh-bailer-jones.py.',
  );
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const sourceId = (cells[idx.source_id] ?? '').trim();
    if (!sourceId) continue;
    const photogeo = parseFloat((cells[idx.r_med_photogeo] ?? '').trim());
    const geo = parseFloat((cells[idx.r_med_geo] ?? '').trim());
    const d = Number.isFinite(photogeo)
      ? photogeo
      : Number.isFinite(geo) ? geo : NaN;
    if (!Number.isFinite(d) || d <= 0) continue;
    out.set(sourceId, d);
  }
  return out;
}

// ---- Gaia DR3 Apsis astrophysical parameters ----------------------------

/** Per-source Apsis fields from `data/gaia/gaia_dr3_apsis.tsv`. The seven
 *  float columns (gspphot ∪ gspspec) are `number | null` — gspphot and
 *  gspspec are independent solutions and either or both may be absent
 *  for a given source_id. NaN-when-empty decoding lifts to the binary
 *  layer via `NO_APSIS`. `spectraltypeEsphs` is the GSP-Spec spectral-type
 *  enum (Recio-Blanco+23): one of "O", "B", "A", "F", "G", "K", "M",
 *  "CSTAR", or "unknown"; consumed by the spectral resolver as the
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

/** Parse the TSV produced by `scripts/refresh/refresh-gaia-apsis.py` into
 *  a Gaia DR3 source_id → ApsisRow map. `source_id` is kept as a string:
 *  Gaia source_ids exceed Number.MAX_SAFE_INTEGER so any numeric parse
 *  would silently corrupt the join key. Blank cells decode to `null` —
 *  the writer maps `null` to `NO_APSIS` (NaN) at pack time. */
export function parseGaiaApsisTsv(text: string): Map<string, ApsisRow> {
  const out = new Map<string, ApsisRow>();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return out;
  const header = lines[0].split('\t').map((h) => h.trim());
  const cols = [
    'source_id',
    'teff_gspphot', 'logg_gspphot', 'mh_gspphot', 'azero_gspphot',
    'teff_gspspec', 'logg_gspspec', 'mh_gspspec',
    'spectraltype_esphs',
  ] as const;
  const idx: Record<(typeof cols)[number], number> = Object.create(null);
  const missing: string[] = [];
  for (const c of cols) {
    const i = header.indexOf(c);
    if (i < 0) missing.push(c);
    idx[c] = i;
  }
  if (missing.length) {
    throw new Error(
      `Gaia DR3 Apsis TSV is missing required columns: ${missing.join(', ')}. ` +
        `Re-run scripts/refresh/refresh-gaia-apsis.py.`,
    );
  }
  const cell = (cells: string[], i: number): number | null => {
    const s = (cells[i] ?? '').trim();
    if (!s) return null;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
  };
  const strCell = (cells: string[], i: number): string | null => {
    const s = (cells[i] ?? '').trim();
    return s ? s : null;
  };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const sourceId = (cells[idx.source_id] ?? '').trim();
    if (!sourceId) continue;
    out.set(sourceId, {
      teffGspphot: cell(cells, idx.teff_gspphot),
      loggGspphot: cell(cells, idx.logg_gspphot),
      mhGspphot: cell(cells, idx.mh_gspphot),
      azeroGspphot: cell(cells, idx.azero_gspphot),
      teffGspspec: cell(cells, idx.teff_gspspec),
      loggGspspec: cell(cells, idx.logg_gspspec),
      mhGspspec: cell(cells, idx.mh_gspspec),
      spectraltypeEsphs: strCell(cells, idx.spectraltype_esphs),
    });
  }
  return out;
}

/** Apparent magnitude → absolute magnitude at given distance.
 *  M = m − 5·log₁₀(d / 10 pc). */
export function apparentToAbsoluteMagnitude(mag: number, distPc: number): number {
  return mag - 5 * Math.log10(distPc / 10);
}

/** Absolute magnitude → apparent magnitude at given distance.
 *  m = M + 5·log₁₀(d / 10 pc). */
export function absoluteToApparentMagnitude(absmag: number, distPc: number): number {
  return absmag + 5 * Math.log10(distPc / 10);
}

/** When `gaiaSourceId` has a Bailer-Jones entry, returns the snapped distance
 *  in parsecs; otherwise null.
 *
 *  Every distance-override layer (Bailer-Jones, LMC kinematic, and future SMC
 *  kinematic / structural-disc / OGLE Cepheid layers) returns a bare distance:
 *  absmag is derived once from the V cascade and the distance the whole stack
 *  settled on (`photometry/README.md` § The V cascade), so a layer cannot
 *  place a star at a new distance while lighting it for the old one. xyz is
 *  likewise not a layer's business — position is direction × distance, with
 *  the direction resolved independently by the direction cascade. */
export function applyBailerJonesOverride(
  gaiaSourceId: string | null,
  bjMap: Map<string, number>,
): number | null {
  if (!gaiaSourceId) return null;
  return bjMap.get(gaiaSourceId) ?? null;
}

// ---- LMC kinematic distance override -------------------------------------

// LMC kinematic parameters. References:
//   - Pietrzyński et al. 2019 (Nature 567, 200): eclipsing-binary distance
//     49.594 ± 0.55 kpc.
//   - van der Marel & Kallivayalil 2014 (ApJ 781, 121): PM dynamical centre
//     (RA, Dec) = (78.76°, −69.19°) = (05h 15m 02s, −69° 11′ 24″) — their
//     PM-field fit, not the NED/SIMBAD photometric centre (05h 23m 34s,
//     −69° 45′). Same paper's centre-of-mass bulk PM: μ_α* = +1.910 ± 0.020,
//     μ_δ = +0.229 ± 0.047 mas/yr. The gate centre below (1.85, 0.20) is a
//     rounded working value toward the field-mean (centroid) PM — the
//     COM−gate difference (≤ 0.07 mas/yr) and the disc's internal-rotation
//     spread (±0.3 mas/yr) both sit well inside the ±0.5 tolerance.
//   - The 15° cone is wide enough to admit the visible disc and
//     30 Doradus while keeping confusion with Galactic foreground low.
// Tolerances chosen so AT-HYG halo / runaway stars in the same sky region
// (which have very different PMs) fail the test — see catalog-pure.test.ts.
export const LMC_DISTANCE_PC = 49_594;
export const LMC_CENTRE_RA_HOURS = 5.25067;       // 78.76° / 15
export const LMC_CENTRE_DEC_DEG = -69.19;
export const LMC_CONE_HALF_ANGLE_DEG = 15;
export const LMC_PM_RA_CENTRE = 1.85;             // mas/yr
export const LMC_PM_DEC_CENTRE = 0.20;            // mas/yr
export const LMC_PM_TOLERANCE = 0.5;              // mas/yr per component

/** Angular separation (degrees) between two ICRS positions. Vector
 *  dot-product form — stable for small and wide separations alike, no
 *  cos/sin of differences. Input RA is hours, Dec is degrees. */
export function angularSeparationDeg(
  raHoursA: number,
  decDegA: number,
  raHoursB: number,
  decDegB: number,
): number {
  const raA = raHoursA * (Math.PI / 12);
  const raB = raHoursB * (Math.PI / 12);
  const decA = decDegA * (Math.PI / 180);
  const decB = decDegB * (Math.PI / 180);
  const cosDecA = Math.cos(decA);
  const cosDecB = Math.cos(decB);
  const ax = cosDecA * Math.cos(raA);
  const ay = cosDecA * Math.sin(raA);
  const az = Math.sin(decA);
  const bx = cosDecB * Math.cos(raB);
  const by = cosDecB * Math.sin(raB);
  const bz = Math.sin(decB);
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  return Math.acos(dot) * (180 / Math.PI);
}

/** Whether (raHours, decDegrees) falls within the LMC sky cone — the
 *  population predicate behind the `lmcCandidates` build-counter. */
export function isInLmcCone(raHours: number, decDegrees: number): boolean {
  const sep = angularSeparationDeg(
    raHours, decDegrees,
    LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG,
  );
  return sep <= LMC_CONE_HALF_ANGLE_DEG;
}

/** When (raHours, decDegrees) is inside the LMC sky cone AND (pmRa, pmDec)
 *  lies within tolerance of the LMC bulk-PM centre, returns Pietrzyński 2019's
 *  distance. Otherwise null — the caller leaves the row's existing distance in
 *  place (which after B-J is either the B-J posterior or AT-HYG's 1/π). Every
 *  gate is evaluated here, so no caller can produce an override by forgetting
 *  one. */
export function applyLmcKinematicOverride(
  raHours: number,
  decDegrees: number,
  pmRa: number | null,
  pmDec: number | null,
): number | null {
  if (pmRa === null || pmDec === null) return null;
  if (!isInLmcCone(raHours, decDegrees)) return null;
  if (Math.abs(pmRa - LMC_PM_RA_CENTRE) > LMC_PM_TOLERANCE) return null;
  if (Math.abs(pmDec - LMC_PM_DEC_CENTRE) > LMC_PM_TOLERANCE) return null;
  return LMC_DISTANCE_PC;
}
