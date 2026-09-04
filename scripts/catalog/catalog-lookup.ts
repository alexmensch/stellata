// AoS reader + per-key indexes for the binary catalogue, used by
// test-time corpus iteration. Decodes through catalog-pure.ts's reader
// surface, same as the runtime SoA loader.

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import {
  AMP_MAG_PER_UNIT,
  APSIS_FIELDS,
  type ApsisField,
  FLAG_HAS_NAME,
  NO_COMPANION,
  NO_CONSTELLATION_INDEX,
  PERIOD_DAYS_PER_UNIT,
  HEADER_SIZE,
  RECORD_SIZE,
  CATALOG_MANIFEST_FILENAME,
  catalogChunkFilename,
  assembleCatalogChunks,
  readCatalogHeader,
  readNameTable,
  readRecordField,
  buildAliasedIdIndex,
  readRecordFieldBig,
  type CatalogHeaderFields,
  type CatalogManifest,
  type SearchEntry,
} from './catalog-pure';
import { displayNamesFromSearchIndex } from './naming/star-naming-pure';
import { REPO_ROOT } from '../util/paths';
import type { RecordRef } from './parse/corpus-tsv';

export const DEFAULT_CATALOG_MANIFEST = resolve(REPO_ROOT, 'public', CATALOG_MANIFEST_FILENAME);
export const DEFAULT_CONSTELLATIONS_JSON = resolve(REPO_ROOT, 'public/constellations.json');
/** The two sidecars a record's full designation set needs beyond the binary —
 *  `hd`/`hr`/`gl` and the synthetic keys. */
export const DEFAULT_SEARCH_INDEX = resolve(REPO_ROOT, 'public/search-index.json');
export const DEFAULT_ROW_INDEX_MAP = resolve(REPO_ROOT, 'public/catalog-row-index-map.json');

/** Read + reassemble the transport-chunked catalog binary from a manifest
 *  path. The client loader's Node-side twin — same `assembleCatalogChunks`
 *  contract, fs instead of fetch. */
export async function readCatalogBuffer(
  manifestPath: string = DEFAULT_CATALOG_MANIFEST,
): Promise<ArrayBuffer> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as CatalogManifest;
  const dir = dirname(manifestPath);
  const chunks = await Promise.all(
    manifest.chunkBytes.map((_, i) =>
      readFile(resolve(dir, catalogChunkFilename(i))).then(
        (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
      ),
    ),
  );
  return assembleCatalogChunks(chunks, manifest);
}

export interface CatalogRecord {
  i: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;  // space-motion velocity, pc/yr
  absmag: number;
  ci: number;
  physicalRadius: number;
  companion: number | null;
  spectClass: number;
  lumClass: number;
  conIndex: number;
  flags: number;
  amplitudeMag: number;
  periodDays: number;
  varType: number;
  hip: number | null;
  gaiaSourceId: bigint | null;
  multiplicityStatus: number; // MULTIPLICITY_*
  teffGspphot: number | null;
  loggGspphot: number | null;
  mhGspphot: number | null;
  azeroGspphot: number | null;
  teffGspspec: number | null;
  loggGspspec: number | null;
  mhGspspec: number | null;
  name: string | null;
  conCode: string | null;
}

export interface Catalog {
  readonly header: CatalogHeaderFields;
  readonly count: number;
  record(i: number): CatalogRecord;
  records(): IterableIterator<CatalogRecord>;
  /** Present only when loaded `withSearchIndex`. The binary carries no HD
   *  column, so `hd:` refs resolve through here or not at all, and it is
   *  what a `name:` ref needs to reach a record displaying a DESIGNATION. */
  readonly searchIndex?: readonly SearchEntry[];
  readonly constellations: readonly ConstellationEntry[];
}

export interface LoadCatalogOptions {
  catalogManifestPath?: string;
  constellationsJsonPath?: string;
  /** Read `public/search-index.json` alongside the binary. `hd:` refs need
   *  it, and so does any `name:` ref naming a record that displays a
   *  designation rather than a name — catalog.bin's name table carries the
   *  NAME tiers alone (`naming/README.md`). Off by default: it is ~15 MB of
   *  JSON, and every other lookup key is in the binary already. */
  withSearchIndex?: boolean;
  searchIndexPath?: string;
}

interface ConstellationEntry { code: string }

export async function loadCatalog(opts: LoadCatalogOptions = {}): Promise<Catalog> {
  const manifestPath = opts.catalogManifestPath ?? DEFAULT_CATALOG_MANIFEST;
  const conPath = opts.constellationsJsonPath ?? DEFAULT_CONSTELLATIONS_JSON;
  const searchIndexPath = opts.searchIndexPath ?? DEFAULT_SEARCH_INDEX;

  const [ab, conText, searchIndexText] = await Promise.all([
    readCatalogBuffer(manifestPath),
    readFile(conPath, 'utf-8'),
    opts.withSearchIndex ? readFile(searchIndexPath, 'utf-8') : Promise.resolve(null),
  ]);
  const view = new DataView(ab);
  const header = readCatalogHeader(ab);
  const { count, nameTableOffset, nameTableLength } = header;

  const constellations: ConstellationEntry[] = JSON.parse(conText);
  const nameAt = readNameTable(ab, nameTableOffset, nameTableLength);

  function readRecord(i: number): CatalogRecord {
    const off = HEADER_SIZE + i * RECORD_SIZE;
    const flags = readRecordField(view, off, 'flags');
    const nameOffset = readRecordField(view, off, 'nameOffset');
    const name = flags & FLAG_HAS_NAME ? nameAt.get(nameOffset) ?? null : null;
    const comp = readRecordField(view, off, 'companion');
    const conIdx = readRecordField(view, off, 'conIndex');
    const hip = readRecordField(view, off, 'hip');
    const gaiaSourceId = readRecordFieldBig(view, off, 'gaiaSourceId');
    const apsis = {} as Record<ApsisField, number | null>;
    for (const name of APSIS_FIELDS) {
      const v = readRecordField(view, off, name);
      apsis[name] = Number.isNaN(v) ? null : v;
    }
    return {
      i,
      x: readRecordField(view, off, 'x'),
      y: readRecordField(view, off, 'y'),
      z: readRecordField(view, off, 'z'),
      vx: readRecordField(view, off, 'vx'),
      vy: readRecordField(view, off, 'vy'),
      vz: readRecordField(view, off, 'vz'),
      absmag: readRecordField(view, off, 'absmag'),
      ci: readRecordField(view, off, 'ci'),
      physicalRadius: readRecordField(view, off, 'physRadius'),
      companion: comp === NO_COMPANION ? null : comp,
      spectClass: readRecordField(view, off, 'spectClass'),
      lumClass: readRecordField(view, off, 'lumClass'),
      conIndex: conIdx,
      flags,
      amplitudeMag: readRecordField(view, off, 'ampUnits') * AMP_MAG_PER_UNIT,
      periodDays: readRecordField(view, off, 'period') * PERIOD_DAYS_PER_UNIT,
      varType: readRecordField(view, off, 'varType'),
      hip: hip === 0 ? null : hip,
      gaiaSourceId: gaiaSourceId === 0n ? null : gaiaSourceId,
      multiplicityStatus: readRecordField(view, off, 'multiplicityStatus'),
      ...apsis,
      name,
      conCode: conIdx === NO_CONSTELLATION_INDEX ? null : constellations[conIdx]?.code ?? null,
    };
  }

  return {
    header,
    count,
    constellations,
    record: readRecord,
    *records() {
      for (let i = 0; i < count; i++) yield readRecord(i);
    },
    ...(searchIndexText === null
      ? {}
      : { searchIndex: JSON.parse(searchIndexText) as SearchEntry[] }),
  };
}

// ---- Per-key indexes -----------------------------------------------------

// Indexes are computed lazily on first lookup and cached per Catalog. The
// WeakMap keys off the Catalog object so a test that loads two fixtures
// gets one index per fixture without manual invalidation.
interface CatalogIndexes {
  byHip: Map<number, number>;
  byGaiaSourceId: Map<string, number>;
  /** Every string a record DISPLAYS: the name table, plus — where the
   *  search index was loaded — the labels the display-name composer builds
   *  from the wire, which is where a Bayer / Flamsteed / component
   *  designation lives (`naming/README.md`). The name table wins a tie. */
  byName: Map<string, number>;
  /** The composed display label per record index — the reverse of the
   *  designation half of `byName`. Empty without the search index. */
  labelByIndex: Map<number, string>;
  /** Every HD number a record answers to, aliases included, through the same
   *  `buildAliasedIdIndex` the runtime's `hdMap` uses — so a corpus row and the
   *  search box resolve one number to one record. Empty where the catalog was
   *  loaded without its search index. */
  byHd: Map<number, number>;
}
const INDEX_CACHE = new WeakMap<Catalog, CatalogIndexes>();

function getIndexes(catalog: Catalog): CatalogIndexes {
  const hit = INDEX_CACHE.get(catalog);
  if (hit) return hit;
  const byHip = new Map<number, number>();
  const byGaiaSourceId = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const r of catalog.records()) {
    if (r.hip !== null) byHip.set(r.hip, r.i);
    if (r.gaiaSourceId !== null) byGaiaSourceId.set(r.gaiaSourceId.toString(), r.i);
    if (r.name) byName.set(r.name, r.i);
  }
  const byHd = buildAliasedIdIndex(
    catalog.searchIndex ?? [], (e) => e.hd, (e) => e.hda,
  );
  const labelByIndex = new Map<number, string>();
  if (catalog.searchIndex !== undefined) {
    for (const [i, label] of displayNamesFromSearchIndex(
      catalog.searchIndex, catalog.constellations,
    )) {
      labelByIndex.set(i, label.label);
      if (!byName.has(label.label)) byName.set(label.label, i);
    }
  }
  const built = { byHip, byGaiaSourceId, byName, byHd, labelByIndex };
  INDEX_CACHE.set(catalog, built);
  return built;
}

/** What a record DISPLAYS: its name-table entry, else the label the
 *  display-name composer builds from the wire. Null where the record is
 *  outside the search index, which is where the runtime falls back to
 *  `Gaia DR3` / `SID #`. */
export function displayLabel(catalog: Catalog, i: number): string | null {
  const name = catalog.record(i).name;
  if (name !== null) return name;
  return getIndexes(catalog).labelByIndex.get(i) ?? null;
}

export function lookupByHip(catalog: Catalog, hip: number): CatalogRecord | null {
  const i = getIndexes(catalog).byHip.get(hip);
  return i === undefined ? null : catalog.record(i);
}

export function lookupByGaiaSourceId(catalog: Catalog, sourceId: bigint | string): CatalogRecord | null {
  const key = typeof sourceId === 'bigint' ? sourceId.toString() : sourceId;
  const i = getIndexes(catalog).byGaiaSourceId.get(key);
  return i === undefined ? null : catalog.record(i);
}

/** Throws rather than answering null when a name misses and the catalog was
 *  loaded without its search index: the name table holds only the NAME
 *  tiers, so a corpus row naming a star by its DESIGNATION would read as
 *  "no such record" and silently stop testing anything. */
export function lookupByName(catalog: Catalog, name: string): CatalogRecord | null {
  const i = getIndexes(catalog).byName.get(name);
  if (i !== undefined) return catalog.record(i);
  if (catalog.searchIndex === undefined) {
    throw new Error(
      `name: record ref "${name}" missed catalog.bin's name table, which carries `
      + 'only the naming ladder\'s NAME tiers — a designation needs the search '
      + 'index: loadCatalog({ withSearchIndex: true })',
    );
  }
  return null;
}

/** Throws rather than answering null when the catalog was loaded without its
 *  search index: a silent miss would read as "no such record" and quietly
 *  weaken every corpus row addressed this way. */
export function lookupByHd(catalog: Catalog, hd: number): CatalogRecord | null {
  if (catalog.searchIndex === undefined) {
    throw new Error(
      'hd: record refs need the search index — loadCatalog({ withSearchIndex: true })',
    );
  }
  const i = getIndexes(catalog).byHd.get(hd);
  return i === undefined ? null : catalog.record(i);
}

export function lookupByRef(catalog: Catalog, ref: RecordRef): CatalogRecord | null {
  return ref.kind === 'hip' ? lookupByHip(catalog, Number(ref.value))
    : ref.kind === 'gaia' ? lookupByGaiaSourceId(catalog, ref.value)
    : ref.kind === 'hd' ? lookupByHd(catalog, Number(ref.value))
    : lookupByName(catalog, ref.value);
}

/** 3D Euclidean distance from Sol in parsecs. The catalogue stores
 *  floating-origin positions in pc, so this is just the magnitude. */
export function distancePc(record: Pick<CatalogRecord, 'x' | 'y' | 'z'>): number {
  return Math.hypot(record.x, record.y, record.z);
}
