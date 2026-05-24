import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseBinaries,
  loadBinaries,
  BinariesParseError,
  MAGIC,
  VERSION,
  HEADER_SIZE,
  RECORD_SIZE,
  RECORD_LAYOUT,
  FLAG_HAS_ORBIT,
  FLAG_HAS_INCLINATION,
  FLAG_IS_INNER_OF_HIERARCHY,
  NO_PARENT,
} from './binaries-loader';
import { J2000_JD } from '../util/astronomy-constants';

// Round-trip fixture builder mirroring the Python writer. Keeping the
// encoder local to the test pins the wire contract without dragging
// build-time scripts into the unit-test surface.
interface FixtureRecord {
  primaryIdx: number;
  secondaryIdx: number;
  flags: number;
  parentRelation: number;
  pDays: number;
  tJd: number;
  e: number;
  aAU: number;
  iRad: number;
  omegaRad: number;
  OmegaRad: number;
  q: number;
  sepArcsec: number;
  paDeg: number;
  sepPaEpochJd: number;
}

function encodeFixture(records: FixtureRecord[]): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_SIZE + records.length * RECORD_SIZE);
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const enc = new TextEncoder();
  bytes.set(enc.encode(MAGIC), 0);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, records.length, true);
  // bytes 12..15 reserved → already zero
  for (let i = 0; i < records.length; i++) {
    const off = HEADER_SIZE + i * RECORD_SIZE;
    const r = records[i];
    view.setUint32(off + RECORD_LAYOUT.primary_idx, r.primaryIdx, true);
    view.setUint32(off + RECORD_LAYOUT.secondary_idx, r.secondaryIdx, true);
    view.setUint32(off + RECORD_LAYOUT.flags, r.flags, true);
    view.setInt32(off + RECORD_LAYOUT.parent_relation, r.parentRelation, true);
    view.setFloat64(off + RECORD_LAYOUT.P_days, r.pDays, true);
    view.setFloat64(off + RECORD_LAYOUT.T_jd, r.tJd, true);
    view.setFloat32(off + RECORD_LAYOUT.e, r.e, true);
    view.setFloat32(off + RECORD_LAYOUT.a_AU, r.aAU, true);
    view.setFloat32(off + RECORD_LAYOUT.i_rad, r.iRad, true);
    view.setFloat32(off + RECORD_LAYOUT.omega_rad, r.omegaRad, true);
    view.setFloat32(off + RECORD_LAYOUT.Omega_rad, r.OmegaRad, true);
    view.setFloat32(off + RECORD_LAYOUT.q, r.q, true);
    view.setFloat32(off + RECORD_LAYOUT.sep_arcsec, r.sepArcsec, true);
    view.setFloat32(off + RECORD_LAYOUT.pa_deg, r.paDeg, true);
    // sep_pa_epoch_jd is stored as a J2000 offset on the wire — write
    // the offset so the loader round-trips back to the same absolute
    // JD the fixture caller supplies. NaN passes through unchanged.
    const wireEpoch = Number.isNaN(r.sepPaEpochJd)
      ? NaN
      : r.sepPaEpochJd - J2000_JD;
    view.setFloat32(off + RECORD_LAYOUT.sep_pa_epoch_jd, wireEpoch, true);
  }
  return buf;
}

function record(overrides: Partial<FixtureRecord> = {}): FixtureRecord {
  return {
    primaryIdx: 0, secondaryIdx: 1,
    flags: 0,
    parentRelation: NO_PARENT,
    pDays: NaN, tJd: NaN,
    e: NaN, aAU: NaN, iRad: NaN,
    omegaRad: NaN, OmegaRad: NaN, q: NaN,
    sepArcsec: NaN, paDeg: NaN, sepPaEpochJd: NaN,
    ...overrides,
  };
}

describe('parseBinaries', () => {
  it('rejects a buffer too short for the header', () => {
    const buf = new ArrayBuffer(8);
    expect(() => parseBinaries(buf))
      .toThrowError(BinariesParseError);
  });

  it('rejects a wrong magic number', () => {
    const buf = new ArrayBuffer(HEADER_SIZE);
    const bytes = new Uint8Array(buf);
    bytes.set(new TextEncoder().encode('XXXX'), 0);
    try {
      parseBinaries(buf);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BinariesParseError);
      expect((e as BinariesParseError).kind).toBe('magic');
    }
  });

  it('rejects an unsupported version', () => {
    const buf = new ArrayBuffer(HEADER_SIZE);
    const bytes = new Uint8Array(buf);
    bytes.set(new TextEncoder().encode(MAGIC), 0);
    new DataView(buf).setUint32(4, 99, true);
    try {
      parseBinaries(buf);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BinariesParseError);
      expect((e as BinariesParseError).kind).toBe('version');
    }
  });

  it('rejects a buffer truncated mid-record', () => {
    const fixture = encodeFixture([record()]);
    // Trim one byte off the end → declared count=1 but only 71 record bytes.
    const truncated = fixture.slice(0, fixture.byteLength - 1);
    try {
      parseBinaries(truncated);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BinariesParseError);
      expect((e as BinariesParseError).kind).toBe('truncated');
    }
  });

  it('round-trips a record carrying every field', () => {
    const r = record({
      primaryIdx: 12345, secondaryIdx: 67890,
      flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
      parentRelation: NO_PARENT,
      pDays: 29133.0705,
      tJd: 2435314.751,
      e: 0.51947,
      aAU: 23.175369,
      iRad: 1.383051,
      omegaRad: 4.040769,
      OmegaRad: 3.579199,
      q: 0.431818,
      sepArcsec: 8.1,
      paDeg: 5.0,
      sepPaEpochJd: 2459945.75,
    });
    const buf = encodeFixture([r]);
    const data = parseBinaries(buf);
    expect(data.version).toBe(VERSION);
    expect(data.relations).toHaveLength(1);
    const out = data.relations[0];
    expect(out.primaryIdx).toBe(12345);
    expect(out.secondaryIdx).toBe(67890);
    expect(out.flags).toBe(FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION);
    expect(out.parentRelation).toBe(NO_PARENT);
    // float64s round-trip exactly through IEEE 754; float32s round to
    // ~7 significant figures.
    expect(out.pDays).toBe(29133.0705);
    expect(out.tJd).toBe(2435314.751);
    expect(out.e).toBeCloseTo(0.51947, 5);
    expect(out.aAU).toBeCloseTo(23.175369, 4);
    expect(out.iRad).toBeCloseTo(1.383051, 5);
    expect(out.q).toBeCloseTo(0.431818, 5);
    expect(out.sepArcsec).toBeCloseTo(8.1, 5);
    // sepPaEpochJd is stored on the wire as a J2000 offset; the loader
    // adds J2000_JD back. JD 2459945.75 is ~8400.75 days from J2000, so
    // float32 precision at that magnitude is ~2^-10 ≈ 0.001 day — well
    // under one minute.
    expect(out.sepPaEpochJd).toBeCloseTo(2459945.75, 2);
  });

  it('preserves wire-format precision: a 1980 epoch survives the JD→offset→JD round-trip', () => {
    // 1980 sits ~36525 days before J2000; the worst-case offset magnitude
    // in the WDS window (~125 years span). float32 precision at |offset|
    // ≈ 36525 is ~2^-7 ≈ 0.008 day; the absolute JD survives to within
    // ~10 minutes — sufficient for static-placement consumers.
    const jd1980 = 2444240.0;  // J2000 - 20 × 365.25
    const r = record({ primaryIdx: 1, secondaryIdx: 2, sepPaEpochJd: jd1980 });
    const data = parseBinaries(encodeFixture([r]));
    expect(data.relations[0].sepPaEpochJd).toBeCloseTo(jd1980, 1);
  });

  it('builds a primary index → relations map keyed by primaryIdx', () => {
    // Two-pair system: α Cen's AB pair AND a hypothetical AC pair both
    // primary-anchored at idx 100. The primary should resolve to both
    // relations.
    const buf = encodeFixture([
      record({ primaryIdx: 100, secondaryIdx: 101 }),
      record({ primaryIdx: 100, secondaryIdx: 102 }),
      record({ primaryIdx: 200, secondaryIdx: 201 }),
    ]);
    const data = parseBinaries(buf);
    expect(data.primaryIdxToRelations.get(100)).toEqual([0, 1]);
    expect(data.primaryIdxToRelations.get(200)).toEqual([2]);
    expect(data.primaryIdxToRelations.has(101)).toBe(false);
  });

  it('builds a secondary index → relation map keeping the first occurrence on collision', () => {
    const buf = encodeFixture([
      record({ primaryIdx: 100, secondaryIdx: 101 }),
      record({ primaryIdx: 200, secondaryIdx: 101 }),  // collision
    ]);
    const data = parseBinaries(buf);
    expect(data.secondaryIdxToRelation.get(101)).toBe(0);
  });

  it('preserves parent-relation indices on a 2-level hierarchy', () => {
    // Algol shape: outer Aa↔Ab (idx 0), inner Aa1↔Aa2 (idx 1) whose
    // parent_relation references the outer (idx 0).
    const buf = encodeFixture([
      record({
        primaryIdx: 10, secondaryIdx: 11,
        flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
      }),
      record({
        primaryIdx: 10, secondaryIdx: 12,
        flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION | FLAG_IS_INNER_OF_HIERARCHY,
        parentRelation: 0,
      }),
    ]);
    const data = parseBinaries(buf);
    expect(data.relations[0].parentRelation).toBe(NO_PARENT);
    expect(data.relations[1].parentRelation).toBe(0);
    expect(data.relations[1].flags & FLAG_IS_INNER_OF_HIERARCHY).toBeTruthy();
  });

  it('parses NaN sentinels through float fields when has_orbit is unset', () => {
    const buf = encodeFixture([
      record({ primaryIdx: 1, secondaryIdx: 2, flags: 0 }),
    ]);
    const data = parseBinaries(buf);
    expect(Number.isNaN(data.relations[0].pDays)).toBe(true);
    expect(Number.isNaN(data.relations[0].iRad)).toBe(true);
  });
});

describe('loadBinaries', () => {
  const savedFetch = (globalThis as { fetch?: unknown }).fetch;

  function mockFetch(impl: (url: string) => Promise<Response | never>) {
    (globalThis as { fetch: (url: string) => Promise<Response> }).fetch = impl;
  }

  beforeEach(() => {
    (globalThis as { fetch?: unknown }).fetch = undefined;
  });
  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = savedFetch;
  });

  it('returns null on network error', async () => {
    mockFetch(() => Promise.reject(new Error('offline')));
    const out = await loadBinaries('/binaries.bin');
    expect(out).toBeNull();
  });

  it('returns null on 404', async () => {
    mockFetch(async () =>
      ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }) as Response);
    const out = await loadBinaries('/binaries.bin');
    expect(out).toBeNull();
  });

  it('parses a valid fetch response', async () => {
    const fixture = encodeFixture([
      record({ primaryIdx: 7, secondaryIdx: 8 }),
    ]);
    mockFetch(async () =>
      ({ ok: true, arrayBuffer: async () => fixture }) as Response);
    const out = await loadBinaries('/binaries.bin');
    expect(out).not.toBeNull();
    expect(out!.relations[0].primaryIdx).toBe(7);
  });

  it('returns null on a magic-byte mismatch (covers the Vite dev-server HTML5 fallback case)', async () => {
    const htmlLike = new TextEncoder().encode('<!DOCTYPE html><html><head>');
    mockFetch(async () =>
      ({ ok: true, arrayBuffer: async () => htmlLike.buffer }) as Response);
    const out = await loadBinaries('/binaries.bin');
    expect(out).toBeNull();
  });

  it('returns null on a payload smaller than the 4-byte magic', async () => {
    const tiny = new ArrayBuffer(2);
    mockFetch(async () =>
      ({ ok: true, arrayBuffer: async () => tiny }) as Response);
    const out = await loadBinaries('/binaries.bin');
    expect(out).toBeNull();
  });

  it('rethrows on a present BIN1 payload that is version-mismatched (hard failure signal)', async () => {
    // BIN1 magic + version=99 (unsupported) + count=0 — header-size buffer.
    const buf = new ArrayBuffer(HEADER_SIZE);
    const u8 = new Uint8Array(buf);
    u8.set(new TextEncoder().encode('BIN1'), 0);
    new DataView(buf).setUint32(4, 99, true);
    mockFetch(async () =>
      ({ ok: true, arrayBuffer: async () => buf }) as Response);
    await expect(loadBinaries('/binaries.bin'))
      .rejects.toBeInstanceOf(BinariesParseError);
  });
});
