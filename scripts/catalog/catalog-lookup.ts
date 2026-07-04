// AoS reader + per-key indexes for the v6 binary catalogue, used by
// test-time corpus iteration. Shares LAYOUT constants with
// catalog-pure.ts.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BINARY_VERSION,
  FLAG_HAS_NAME,
  HEADER_LAYOUT,
  MAGIC,
  NAME_LENGTH_PREFIX_BYTES,
  NAME_TABLE_PADDING,
  NO_COMPANION,
  NO_CONSTELLATION_INDEX,
  RECORD_LAYOUT,
  HEADER_SIZE,
  RECORD_SIZE,
} from './catalog-pure';
import { REPO_ROOT } from '../util/paths';

export const DEFAULT_CATALOG_BIN = resolve(REPO_ROOT, 'public/catalog.bin');
export const DEFAULT_CONSTELLATIONS_JSON = resolve(REPO_ROOT, 'public/constellations.json');

export interface CatalogRecord {
  i: number;
  x: number; y: number; z: number;
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

export interface CatalogHeader {
  magic: string;
  version: number;
  count: number;
  nameTableOffset: number;
  nameTableLength: number;
}

export interface Catalog {
  readonly header: CatalogHeader;
  readonly count: number;
  record(i: number): CatalogRecord;
  records(): IterableIterator<CatalogRecord>;
}

export interface LoadCatalogOptions {
  catalogBinPath?: string;
  constellationsJsonPath?: string;
}

interface ConstellationEntry { code: string }

export async function loadCatalog(opts: LoadCatalogOptions = {}): Promise<Catalog> {
  const binPath = opts.catalogBinPath ?? DEFAULT_CATALOG_BIN;
  const conPath = opts.constellationsJsonPath ?? DEFAULT_CONSTELLATIONS_JSON;

  const [binBuf, conText] = await Promise.all([
    readFile(binPath),
    readFile(conPath, 'utf-8'),
  ]);
  const ab = binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength);
  const view = new DataView(ab);

  const magic = new TextDecoder().decode(new Uint8Array(ab, HEADER_LAYOUT.magic, 4));
  if (magic !== MAGIC) throw new Error(`Bad magic: ${magic}`);
  const version = view.getUint32(HEADER_LAYOUT.version, true);
  if (version !== BINARY_VERSION) {
    throw new Error(`Unsupported catalog version: ${version} (expected ${BINARY_VERSION})`);
  }
  const count = view.getUint32(HEADER_LAYOUT.count, true);
  const nameTableOffset = view.getUint32(HEADER_LAYOUT.nameTableOffset, true);
  const nameTableLength = view.getUint32(HEADER_LAYOUT.nameTableLength, true);

  const constellations: ConstellationEntry[] = JSON.parse(conText);

  const nameAt = new Map<number, string>();
  {
    const td = new TextDecoder('utf-8');
    let p = nameTableOffset + NAME_TABLE_PADDING;
    const end = nameTableOffset + nameTableLength;
    while (p < end) {
      const relOff = p - nameTableOffset;
      const len = view.getUint16(p, true);
      p += NAME_LENGTH_PREFIX_BYTES;
      nameAt.set(relOff, td.decode(new Uint8Array(ab, p, len)));
      p += len;
    }
  }

  function readRecord(i: number): CatalogRecord {
    const off = HEADER_SIZE + i * RECORD_SIZE;
    const flags = view.getUint8(off + RECORD_LAYOUT.flags);
    const nameOffset = view.getUint32(off + RECORD_LAYOUT.nameOffset, true);
    const name = flags & FLAG_HAS_NAME ? nameAt.get(nameOffset) ?? null : null;
    const comp = view.getUint32(off + RECORD_LAYOUT.companion, true);
    const conIdx = view.getUint8(off + RECORD_LAYOUT.conIndex);
    const hip = view.getUint32(off + RECORD_LAYOUT.hip, true);
    const gaiaSourceId = view.getBigUint64(off + RECORD_LAYOUT.gaiaSourceId, true);
    const apsisCell = (offsetField: number): number | null => {
      const v = view.getFloat32(off + offsetField, true);
      return Number.isNaN(v) ? null : v;
    };
    return {
      i,
      x: view.getFloat32(off + RECORD_LAYOUT.x, true),
      y: view.getFloat32(off + RECORD_LAYOUT.y, true),
      z: view.getFloat32(off + RECORD_LAYOUT.z, true),
      absmag: view.getFloat32(off + RECORD_LAYOUT.absmag, true),
      ci: view.getFloat32(off + RECORD_LAYOUT.ci, true),
      physicalRadius: view.getFloat32(off + RECORD_LAYOUT.physRadius, true),
      companion: comp === NO_COMPANION ? null : comp,
      spectClass: view.getUint8(off + RECORD_LAYOUT.spectClass),
      lumClass: view.getUint8(off + RECORD_LAYOUT.lumClass),
      conIndex: conIdx,
      flags,
      amplitudeMag: view.getUint8(off + RECORD_LAYOUT.ampUnits) * 0.05,
      periodDays: view.getUint16(off + RECORD_LAYOUT.period, true) * 0.1,
      varType: view.getUint8(off + RECORD_LAYOUT.varType),
      hip: hip === 0 ? null : hip,
      gaiaSourceId: gaiaSourceId === 0n ? null : gaiaSourceId,
      teffGspphot: apsisCell(RECORD_LAYOUT.teffGspphot),
      loggGspphot: apsisCell(RECORD_LAYOUT.loggGspphot),
      mhGspphot: apsisCell(RECORD_LAYOUT.mhGspphot),
      azeroGspphot: apsisCell(RECORD_LAYOUT.azeroGspphot),
      teffGspspec: apsisCell(RECORD_LAYOUT.teffGspspec),
      loggGspspec: apsisCell(RECORD_LAYOUT.loggGspspec),
      mhGspspec: apsisCell(RECORD_LAYOUT.mhGspspec),
      name,
      conCode: conIdx === NO_CONSTELLATION_INDEX ? null : constellations[conIdx]?.code ?? null,
    };
  }

  return {
    header: { magic, version, count, nameTableOffset, nameTableLength },
    count,
    record: readRecord,
    *records() {
      for (let i = 0; i < count; i++) yield readRecord(i);
    },
  };
}

// ---- Per-key indexes -----------------------------------------------------

// Indexes are computed lazily on first lookup and cached per Catalog. The
// WeakMap keys off the Catalog object so a test that loads two fixtures
// gets one index per fixture without manual invalidation.
interface CatalogIndexes {
  byHip: Map<number, number>;
  byGaiaSourceId: Map<string, number>;
  byName: Map<string, number>;
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
  const built = { byHip, byGaiaSourceId, byName };
  INDEX_CACHE.set(catalog, built);
  return built;
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

export function lookupByName(catalog: Catalog, name: string): CatalogRecord | null {
  const i = getIndexes(catalog).byName.get(name);
  return i === undefined ? null : catalog.record(i);
}

/** 3D Euclidean distance from Sol in parsecs. The catalogue stores
 *  floating-origin positions in pc, so this is just the magnitude. */
export function distancePc(record: Pick<CatalogRecord, 'x' | 'y' | 'z'>): number {
  return Math.hypot(record.x, record.y, record.z);
}
