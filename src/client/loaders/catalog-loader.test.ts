import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadCatalog, parseBinary, type Constellation } from './catalog-loader';
import {
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  FLAG_HAS_BAYER,
  FLAG_BINARY_PRIMARY,
  HEADER_LAYOUT,
  HEADER_SIZE,
  RECORD_SIZE,
  NO_APSIS,
  APSIS_FIELDS,
  type ApsisField,
  type WireStarRecord,
  writeStarRecord,
  writeCatalogHeader,
  catalogChunkFilename,
  planCatalogChunks,
  assembleCatalogChunks,
  type CatalogManifest,
} from '../../../scripts/catalog/catalog-pure';

// Test-side view of one record: WireStarRecord with the wide/rarely-set
// fields defaulted so fixtures stay terse. Encoded through the REAL
// writer (writeStarRecord), so every parse below is a writer→reader
// round-trip of the shipped layout.
type StarRecord = Omit<WireStarRecord, 'apsis'> & { apsis: Record<ApsisField, number> };

function nanApsis(): Record<ApsisField, number> {
  const out = {} as Record<ApsisField, number>;
  for (const name of APSIS_FIELDS) out[name] = NO_APSIS;
  return out;
}

// Build a synthetic catalog buffer through the shared writer. Tests
// construct the smallest reasonable catalogs (a few stars + optional name
// table) so the parser sees realistic input without needing the real
// catalog.bin on disk.
function buildCatalog(
  records: StarRecord[],
  names: { offset: number; name: string }[] = [],
): ArrayBuffer {
  // Name table layout: 2 bytes of zero padding (offset-0 sentinel),
  // then for each name: uint16 length, then UTF-8 bytes.
  const enc = new TextEncoder();
  const encodedNames = names.map(n => ({ ...n, bytes: enc.encode(n.name) }));
  let nameTableLength = 2;
  for (const n of encodedNames) nameTableLength += 2 + n.bytes.length;

  const total = HEADER_SIZE + records.length * RECORD_SIZE
    + (encodedNames.length > 0 ? nameTableLength : 0);
  const ab = new ArrayBuffer(total);
  const dv = new DataView(ab);
  const u8 = new Uint8Array(ab);

  const nameTableOffset = encodedNames.length > 0
    ? HEADER_SIZE + records.length * RECORD_SIZE
    : 0;
  writeCatalogHeader(dv, {
    count: records.length,
    nameTableOffset,
    nameTableLength: encodedNames.length > 0 ? nameTableLength : 0,
  });

  records.forEach((r, i) => writeStarRecord(dv, HEADER_SIZE + i * RECORD_SIZE, r));

  // Name table (after records). parseBinary stores each entry under the
  // offset of its length prefix relative to the name-table start; tests
  // pass that same value through StarRecord.nameOffset.
  if (encodedNames.length > 0) {
    let p = nameTableOffset + 2; // skip 2-byte zero-sentinel padding
    for (const n of encodedNames) {
      dv.setUint16(p, n.bytes.length, true);
      u8.set(n.bytes, p + 2);
      p += 2 + n.bytes.length;
    }
  }

  return ab;
}

// Convenience for building name-table entries with computed offsets.
// Returns the offset (relative to the name-table start, which is what
// parseBinary stores) that should go in StarRecord.nameOffset.
function nameTableOffsets(names: string[]): number[] {
  const enc = new TextEncoder();
  const offsets: number[] = [];
  let p = 2; // skip the 2-byte zero-sentinel padding at table start
  for (const n of names) {
    offsets.push(p);
    p += 2 + enc.encode(n).length;
  }
  return offsets;
}

const blankConstellations: Constellation[] = [];

function sliceByPlan(buf: Uint8Array, chunkBytes: number[]): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let off = 0;
  for (const n of chunkBytes) {
    chunks.push(buf.subarray(off, off + n));
    off += n;
  }
  return chunks;
}

// A Response whose body streams `data` in `reads` slices, so the loader's
// per-read progress callback fires more than once per chunk.
function streamedResponse(data: Uint8Array, reads: number): Response {
  const step = Math.max(1, Math.ceil(data.byteLength / reads));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let o = 0; o < data.byteLength; o += step) {
        controller.enqueue(data.subarray(o, Math.min(o + step, data.byteLength)));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

const baseStar: StarRecord = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  absmag: 0,
  ci: 0,
  physRadius: 1,
  companionIdx: 0xffffffff,
  nameOffset: 0,
  spectClass: 0,
  lumClass: 255,
  conIndex: 0,
  flags: 0,
  ampUnits: 0,
  periodUnits: 0,
  varType: 0,
  hip: 0,
  gaiaSourceId: 0n,
  apsis: nanApsis(),
  sid: 0,
  multiplicityStatus: 0,
};

describe('catalog-loader / parseBinary', () => {
  describe('header validation', () => {
    it('rejects buffer with bad magic', () => {
      const ab = new ArrayBuffer(HEADER_SIZE);
      const u8 = new Uint8Array(ab);
      u8[0] = 'B'.charCodeAt(0);
      u8[1] = 'A'.charCodeAt(0);
      u8[2] = 'D'.charCodeAt(0);
      u8[3] = '!'.charCodeAt(0);
      expect(() => parseBinary(ab, blankConstellations)).toThrow(/Bad magic/);
    });

    it('rejects unsupported version', () => {
      const buf = buildCatalog([]);
      new DataView(buf).setUint32(HEADER_LAYOUT.version, 99, true);
      expect(() => parseBinary(buf, blankConstellations)).toThrow(/version: 99/);
    });

    it('parses empty catalog (count=0)', () => {
      const buf = buildCatalog([]);
      const cat = parseBinary(buf, blankConstellations);
      expect(cat.count).toBe(0);
      expect(cat.positions.length).toBe(0);
      expect(cat.solIndex).toBe(-1);
      expect(cat.names.size).toBe(0);
    });
  });

  describe('record fields', () => {
    it('parses positions, absmag, ci, physicalRadius', () => {
      const star: StarRecord = {
        ...baseStar,
        x: 1.5, y: -2.5, z: 3.5,
        absmag: 4.83,
        ci: 0.65,
        physRadius: 1.0,
      };
      const cat = parseBinary(buildCatalog([star]), blankConstellations);
      expect(cat.count).toBe(1);
      expect(cat.positions[0]).toBeCloseTo(1.5, 5);
      expect(cat.positions[1]).toBeCloseTo(-2.5, 5);
      expect(cat.positions[2]).toBeCloseTo(3.5, 5);
      expect(cat.absmag[0]).toBeCloseTo(4.83, 5);
      expect(cat.ci[0]).toBeCloseTo(0.65, 5);
      expect(cat.physicalRadius[0]).toBeCloseTo(1.0, 5);
    });

    it('parses the v8 space-motion velocity columns', () => {
      const star: StarRecord = {
        ...baseStar,
        x: 1, y: 2, z: 3,
        vx: 1.5e-5, vy: -2.5e-5, vz: 3.5e-6,
      };
      const cat = parseBinary(buildCatalog([star]), blankConstellations);
      expect(cat.velocities).toHaveLength(3);
      expect(cat.velocities[0]).toBeCloseTo(1.5e-5, 10);
      expect(cat.velocities[1]).toBeCloseTo(-2.5e-5, 10);
      expect(cat.velocities[2]).toBeCloseTo(3.5e-6, 10);
    });

    it('parses spectClass / luminosityClass / constellation as small ints', () => {
      const star: StarRecord = {
        ...baseStar,
        spectClass: 5,
        lumClass: 3,
        conIndex: 42,
      };
      const cat = parseBinary(buildCatalog([star]), blankConstellations);
      expect(cat.spectClass[0]).toBe(5);
      expect(cat.luminosityClass[0]).toBe(3);
      expect(cat.constellation[0]).toBe(42);
    });

    it('parses HIP id', () => {
      const star: StarRecord = { ...baseStar, hip: 32349 };
      const cat = parseBinary(buildCatalog([star]), blankConstellations);
      expect(cat.hip[0]).toBe(32349);
    });

    it('parses HIP=0 as no-HIP star', () => {
      const cat = parseBinary(buildCatalog([{ ...baseStar, hip: 0 }]), blankConstellations);
      expect(cat.hip[0]).toBe(0);
    });

    it('round-trips every record field with distinct values through the shared writer', () => {
      // Distinct value per field so any swapped assignment (writer OR
      // reader) fails on the exact field name, not by coincidence.
      const star: StarRecord = {
        x: 1.25, y: -2.5, z: 3.75,
        vx: 1e-5, vy: -2e-5, vz: 3e-6,
        absmag: 4.83,
        ci: 0.65,
        physRadius: 2.25,
        companionIdx: 7,
        nameOffset: 0,
        spectClass: 4,
        lumClass: 2,
        conIndex: 41,
        flags: FLAG_HAS_BAYER | FLAG_BINARY_PRIMARY,
        ampUnits: 9,
        periodUnits: 1234,
        varType: 2,
        hip: 65241,
        gaiaSourceId: 3716436373755666432n, // > 2^53: must survive BigUint64
        apsis: {
          teffGspphot: 5777, loggGspphot: 4.44, mhGspphot: 0.01, azeroGspphot: 0.12,
          teffGspspec: 5750, loggGspspec: 4.4, mhGspspec: -0.02,
        },
        sid: 306055,
        multiplicityStatus: 2,
      };
      const cat = parseBinary(buildCatalog([{ ...baseStar }, star]), blankConstellations);
      expect(cat.positions[3]).toBeCloseTo(1.25, 5);
      expect(cat.positions[4]).toBeCloseTo(-2.5, 5);
      expect(cat.positions[5]).toBeCloseTo(3.75, 5);
      expect(cat.velocities[3]).toBeCloseTo(1e-5, 10);
      expect(cat.velocities[4]).toBeCloseTo(-2e-5, 10);
      expect(cat.velocities[5]).toBeCloseTo(3e-6, 10);
      expect(cat.absmag[1]).toBeCloseTo(4.83, 5);
      expect(cat.ci[1]).toBeCloseTo(0.65, 5);
      expect(cat.physicalRadius[1]).toBeCloseTo(2.25, 5);
      expect(cat.companion[1]).toBe(7);
      expect(cat.spectClass[1]).toBe(4);
      expect(cat.luminosityClass[1]).toBe(2);
      expect(cat.constellation[1]).toBe(41);
      expect(cat.flags[1]).toBe(FLAG_HAS_BAYER | FLAG_BINARY_PRIMARY);
      expect(cat.amplitudeMag[1]).toBeCloseTo(0.45, 5);
      expect(cat.periodDays[1]).toBeCloseTo(123.4, 4);
      expect(cat.varType[1]).toBe(2);
      expect(cat.hip[1]).toBe(65241);
      expect(cat.gaiaSourceId[1]).toBe(3716436373755666432n);
      expect(cat.teffGspphot[1]).toBeCloseTo(5777, 1);
      expect(cat.loggGspphot[1]).toBeCloseTo(4.44, 4);
      expect(cat.mhGspphot[1]).toBeCloseTo(0.01, 4);
      expect(cat.azeroGspphot[1]).toBeCloseTo(0.12, 4);
      expect(cat.teffGspspec[1]).toBeCloseTo(5750, 1);
      expect(cat.loggGspspec[1]).toBeCloseTo(4.4, 4);
      expect(cat.mhGspspec[1]).toBeCloseTo(-0.02, 4);
      expect(cat.sid[1]).toBe(306055);
      expect(cat.multiplicityStatus[1]).toBe(2);
      // The all-defaults record keeps its sentinels.
      expect(cat.gaiaSourceId[0]).toBe(0n);
      expect(cat.multiplicityStatus[0]).toBe(0);
      for (const name of APSIS_FIELDS) expect(Number.isNaN(cat[name][0])).toBe(true);
    });

    it('parses the v7 sid column', () => {
      const cat = parseBinary(
        buildCatalog([
          { ...baseStar, sid: 306055 },
          { ...baseStar, sid: 1 },
        ]),
        blankConstellations,
      );
      expect(cat.sid[0]).toBe(306055);
      expect(cat.sid[1]).toBe(1);
    });
  });

  describe('companion sentinel', () => {
    it('decodes 0xffffffff companion as -1', () => {
      const cat = parseBinary(
        buildCatalog([{ ...baseStar, companionIdx: 0xffffffff }]),
        blankConstellations,
      );
      expect(cat.companion[0]).toBe(-1);
    });

    it('preserves a real companion index', () => {
      const cat = parseBinary(
        buildCatalog([
          { ...baseStar },
          { ...baseStar, companionIdx: 0 },
        ]),
        blankConstellations,
      );
      expect(cat.companion[0]).toBe(-1);
      expect(cat.companion[1]).toBe(0);
    });
  });

  describe('flags and solIndex', () => {
    it('sets solIndex when FLAG_IS_SOL is present', () => {
      const cat = parseBinary(
        buildCatalog([
          { ...baseStar },
          { ...baseStar, flags: FLAG_IS_SOL },
          { ...baseStar },
        ]),
        blankConstellations,
      );
      expect(cat.solIndex).toBe(1);
      expect(cat.flags[1] & FLAG_IS_SOL).toBeTruthy();
    });

    it('solIndex stays -1 when no star carries the bit', () => {
      const cat = parseBinary(
        buildCatalog([{ ...baseStar }, { ...baseStar }]),
        blankConstellations,
      );
      expect(cat.solIndex).toBe(-1);
    });

    it('preserves combined flag bits (has_name | is_sol | has_bayer | binary_primary)', () => {
      const allFlags = FLAG_HAS_NAME | FLAG_IS_SOL | FLAG_HAS_BAYER | FLAG_BINARY_PRIMARY;
      const cat = parseBinary(
        buildCatalog([{ ...baseStar, flags: allFlags }]),
        blankConstellations,
      );
      expect(cat.flags[0]).toBe(allFlags);
    });
  });

  describe('variability (amplitude / period)', () => {
    it('decodes amplitude at 0.05 mag units', () => {
      // ampUnits=20 → 1.0 mag
      const cat = parseBinary(
        buildCatalog([{ ...baseStar, ampUnits: 20 }]),
        blankConstellations,
      );
      expect(cat.amplitudeMag[0]).toBeCloseTo(1.0, 5);
    });

    it('decodes period at 0.1 day units', () => {
      // periodUnits=3320 → 332.0 days
      const cat = parseBinary(
        buildCatalog([{ ...baseStar, periodUnits: 3320 }]),
        blankConstellations,
      );
      expect(cat.periodDays[0]).toBeCloseTo(332.0, 5);
    });

    it('non-variable star has 0 amplitude and 0 period', () => {
      const cat = parseBinary(buildCatalog([{ ...baseStar }]), blankConstellations);
      expect(cat.amplitudeMag[0]).toBe(0);
      expect(cat.periodDays[0]).toBe(0);
    });

    it('decodes max-range amplitude (255 → 12.75 mag) and period (65535 → 6553.5 days)', () => {
      const cat = parseBinary(
        buildCatalog([{ ...baseStar, ampUnits: 255, periodUnits: 65535 }]),
        blankConstellations,
      );
      expect(cat.amplitudeMag[0]).toBeCloseTo(12.75, 4);
      expect(cat.periodDays[0]).toBeCloseTo(6553.5, 4);
    });
  });

  describe('name table', () => {
    it('decodes a single named star', () => {
      const names = ['Sirius'];
      const offsets = nameTableOffsets(names);
      const star: StarRecord = {
        ...baseStar,
        flags: FLAG_HAS_NAME, // has_name
        nameOffset: offsets[0],
      };
      const cat = parseBinary(
        buildCatalog([star], names.map((n, i) => ({ offset: offsets[i], name: n }))),
        blankConstellations,
      );
      expect(cat.names.size).toBe(1);
      expect(cat.names.get(0)).toBe('Sirius');
    });

    it('decodes multiple named stars with shared name table', () => {
      const names = ['Sirius', 'Vega', 'Betelgeuse'];
      const offsets = nameTableOffsets(names);
      const records = names.map((_, i) => ({
        ...baseStar,
        flags: FLAG_HAS_NAME,
        nameOffset: offsets[i],
      }));
      const cat = parseBinary(
        buildCatalog(records, names.map((n, i) => ({ offset: offsets[i], name: n }))),
        blankConstellations,
      );
      expect(cat.names.get(0)).toBe('Sirius');
      expect(cat.names.get(1)).toBe('Vega');
      expect(cat.names.get(2)).toBe('Betelgeuse');
    });

    it('skips stars without the has_name flag even when nameOffset is set', () => {
      const names = ['Polaris'];
      const offsets = nameTableOffsets(names);
      const star: StarRecord = {
        ...baseStar,
        flags: 0, // intentionally NOT FLAG_HAS_NAME
        nameOffset: offsets[0],
      };
      const cat = parseBinary(
        buildCatalog([star], names.map((n, i) => ({ offset: offsets[i], name: n }))),
        blankConstellations,
      );
      expect(cat.names.size).toBe(0);
    });

    it('decodes UTF-8 names correctly', () => {
      const names = ['Étoile', 'βCen']; // Latin-1 + Greek
      const offsets = nameTableOffsets(names);
      const records = names.map((_, i) => ({
        ...baseStar,
        flags: FLAG_HAS_NAME,
        nameOffset: offsets[i],
      }));
      const cat = parseBinary(
        buildCatalog(records, names.map((n, i) => ({ offset: offsets[i], name: n }))),
        blankConstellations,
      );
      expect(cat.names.get(0)).toBe('Étoile');
      expect(cat.names.get(1)).toBe('βCen');
    });
  });

  describe('transport chunking (byte-identical reassembly)', () => {
    it('assembles a real v6 catalog buffer byte-identically across chunks', () => {
      const names = ['Sirius', 'Vega', 'Betelgeuse'];
      const offsets = nameTableOffsets(names);
      const records = names.map((_, i) => ({
        ...baseStar,
        x: i + 0.5, y: -i, z: i * 2,
        absmag: i - 1.4,
        flags: FLAG_HAS_NAME,
        nameOffset: offsets[i],
      }));
      const source = new Uint8Array(
        buildCatalog(records, names.map((n, i) => ({ offset: offsets[i], name: n }))),
      );

      const chunkBytes = planCatalogChunks(source.byteLength, 64);
      expect(chunkBytes.length).toBeGreaterThan(1);
      const manifest: CatalogManifest = { chunkBytes, totalBytes: source.byteLength };
      const assembled = assembleCatalogChunks(sliceByPlan(source, chunkBytes), manifest);

      expect(new Uint8Array(assembled)).toEqual(source);
      const cat = parseBinary(assembled, blankConstellations);
      expect(cat.count).toBe(3);
      expect(cat.names.get(2)).toBe('Betelgeuse');
      expect(cat.positions[3]).toBeCloseTo(1.5, 5);
    });
  });

  describe('loadCatalog (manifest → chunks → assemble over fetch)', () => {
    afterEach(() => vi.unstubAllGlobals());

    const MANIFEST_URL = '/assets/catalog-manifest.json';
    const CON_URL = '/assets/constellations.json';

    function stubFetch(routes: Record<string, () => Response>): void {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const make = routes[url];
        if (!make) throw new Error(`unexpected fetch: ${url}`);
        return make();
      }));
    }

    function catalogFixture(): { source: Uint8Array; manifest: CatalogManifest } {
      const names = ['Sirius', 'Vega', 'Betelgeuse'];
      const offsets = nameTableOffsets(names);
      const records = names.map((_, i) => ({
        ...baseStar,
        x: i + 0.5, y: -i, z: i * 2,
        flags: FLAG_HAS_NAME,
        nameOffset: offsets[i],
      }));
      const source = new Uint8Array(
        buildCatalog(records, names.map((n, i) => ({ offset: offsets[i], name: n }))),
      );
      const chunkBytes = planCatalogChunks(source.byteLength, 48);
      return { source, manifest: { chunkBytes, totalBytes: source.byteLength } };
    }

    function chunkRoutes(source: Uint8Array, manifest: CatalogManifest, reads: number) {
      const slices = sliceByPlan(source, manifest.chunkBytes);
      const routes: Record<string, () => Response> = {
        [MANIFEST_URL]: () => new Response(JSON.stringify(manifest)),
        [CON_URL]: () => new Response(JSON.stringify(blankConstellations)),
      };
      slices.forEach((slice, i) => {
        routes[`/assets/${catalogChunkFilename(i)}`] = () => streamedResponse(slice, reads);
      });
      return routes;
    }

    it('fetches sibling chunks by manifest and parses the reassembled catalog', async () => {
      const { source, manifest } = catalogFixture();
      expect(manifest.chunkBytes.length).toBeGreaterThan(1);
      stubFetch(chunkRoutes(source, manifest, 1));

      const cat = await loadCatalog(MANIFEST_URL, CON_URL);
      expect(cat.count).toBe(3);
      expect(cat.names.get(2)).toBe('Betelgeuse');
    });

    it('reports monotonic progress across chunks up to the manifest total', async () => {
      const { source, manifest } = catalogFixture();
      stubFetch(chunkRoutes(source, manifest, 3));

      const seen: number[] = [];
      await loadCatalog(MANIFEST_URL, CON_URL, ({ bytes, total }) => {
        expect(total).toBe(manifest.totalBytes);
        seen.push(bytes);
      });

      // > chunk count proves mid-chunk reporting, not one jump per file.
      expect(seen.length).toBeGreaterThan(manifest.chunkBytes.length);
      for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
      expect(seen[seen.length - 1]).toBe(manifest.totalBytes);
    });

    it('rejects when the manifest fetch fails', async () => {
      stubFetch({
        [MANIFEST_URL]: () => new Response(null, { status: 404 }),
        [CON_URL]: () => new Response(JSON.stringify(blankConstellations)),
      });
      await expect(loadCatalog(MANIFEST_URL, CON_URL)).rejects.toThrow(/manifest\.json: 404/);
    });

    it('rejects when a chunk fetch fails', async () => {
      const { source, manifest } = catalogFixture();
      const routes = chunkRoutes(source, manifest, 1);
      routes[`/assets/${catalogChunkFilename(0)}`] = () => new Response(null, { status: 500 });
      stubFetch(routes);
      await expect(loadCatalog(MANIFEST_URL, CON_URL)).rejects.toThrow(/500/);
    });

    it('rejects a truncated chunk instead of zero-padding it', async () => {
      const { source, manifest } = catalogFixture();
      const routes = chunkRoutes(source, manifest, 1);
      const short = source.subarray(0, manifest.chunkBytes[0] - 1);
      routes[`/assets/${catalogChunkFilename(0)}`] = () => streamedResponse(short, 1);
      stubFetch(routes);
      await expect(
        loadCatalog(MANIFEST_URL, CON_URL, () => {}),
      ).rejects.toThrow(/short read/);
    });
  });

  describe('constellation passthrough', () => {
    it('attaches the supplied constellation array to the result', () => {
      const cons: Constellation[] = [{ code: 'ori', name: 'Orion', lines: [[0, 1]] }];
      const cat = parseBinary(buildCatalog([]), cons);
      expect(cat.constellations).toBe(cons);
    });
  });

  describe('typed-array sizing invariants', () => {
    it('positions array length is count*3', () => {
      const records = Array.from({ length: 7 }, () => ({ ...baseStar }));
      const cat = parseBinary(buildCatalog(records), blankConstellations);
      expect(cat.positions.length).toBe(7 * 3);
      expect(cat.absmag.length).toBe(7);
      expect(cat.ci.length).toBe(7);
      expect(cat.physicalRadius.length).toBe(7);
      expect(cat.spectClass.length).toBe(7);
      expect(cat.luminosityClass.length).toBe(7);
      expect(cat.constellation.length).toBe(7);
      expect(cat.flags.length).toBe(7);
      expect(cat.companion.length).toBe(7);
      expect(cat.periodDays.length).toBe(7);
      expect(cat.amplitudeMag.length).toBe(7);
      expect(cat.hip.length).toBe(7);
      expect(cat.sid.length).toBe(7);
    });
  });
});
