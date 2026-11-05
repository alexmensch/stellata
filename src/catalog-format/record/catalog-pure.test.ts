import { describe, it, expect } from 'vitest';
import {
  VAR_TYPE_ECLIPSING,
  type SearchEntry,
  type SearchEntrySource,
  buildSearchEntry,
  NO_CONSTELLATION_INDEX,
  designationConIndex,
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  FLAG_HAS_BAYER,
  FLAG_BINARY_COMPANION_ONLY,
  FLAG_BINARY_COMPANION_SYNTHETIC,
  FLAG_BINARY_PRIMARY,
  FLAGS,
  RESERVED_FLAG_BITS,
  HEADER_LAYOUT,
  RECORD_LAYOUT,
  HEADER_FIELD_SIZES,
  RECORD_FIELD_SIZES,
  RECORD_RESERVED_TAIL_BYTES,
  MULTIPLICITY_SINGLE,
  MULTIPLICITY_RESOLVED,
  MULTIPLICITY_UNRESOLVED,
  HEADER_SIZE,
  RECORD_SIZE,
  MAGIC,
  BINARY_VERSION,
  NO_APSIS,
  NAME_TABLE_PADDING,
  NAME_LENGTH_PREFIX_BYTES,
  AMP_MAG_PER_UNIT,
  PERIOD_DAYS_PER_UNIT,
  RECORD_FIELD_KINDS,
  encodeAmpUnits,
  encodePeriodUnits,
  decodeRecordColumn,
  decodeRecordColumnBig,
  readCatalogHeader,
  readNameTable,
  encodeNameTable,
  readRecordField,
  readRecordFieldBig,
  writeCatalogHeader,
  writeStarRecord,
  type NumericRecordField,
  type WireStarRecord,
  planCatalogChunks,
  assembleCatalogChunks,
  type CatalogManifest,
} from './catalog-pure';


describe('catalog-pure / binary-format constants', () => {
  it('header offsets are non-overlapping uint32 slots within HEADER_SIZE', () => {
    const fields = Object.entries(HEADER_LAYOUT) as [keyof typeof HEADER_LAYOUT, number][];
    for (const [name, off] of fields) {
      expect(HEADER_FIELD_SIZES[name]).toBeDefined();
      expect(off + HEADER_FIELD_SIZES[name]).toBeLessThanOrEqual(HEADER_SIZE);
    }
    // Pairwise non-overlap.
    for (let i = 0; i < fields.length; i++) {
      for (let j = i + 1; j < fields.length; j++) {
        const [na, oa] = fields[i];
        const [nb, ob] = fields[j];
        const ea = oa + HEADER_FIELD_SIZES[na];
        const eb = ob + HEADER_FIELD_SIZES[nb];
        const overlap = oa < eb && ob < ea;
        expect(overlap, `${na}@${oa}+${HEADER_FIELD_SIZES[na]} overlaps ${nb}@${ob}+${HEADER_FIELD_SIZES[nb]}`).toBe(false);
      }
    }
  });

  it('record offsets are non-overlapping and fit within RECORD_SIZE', () => {
    const fields = Object.entries(RECORD_LAYOUT) as [keyof typeof RECORD_LAYOUT, number][];
    for (const [name, off] of fields) {
      expect(RECORD_FIELD_SIZES[name]).toBeDefined();
      expect(off + RECORD_FIELD_SIZES[name]).toBeLessThanOrEqual(RECORD_SIZE);
    }
    for (let i = 0; i < fields.length; i++) {
      for (let j = i + 1; j < fields.length; j++) {
        const [na, oa] = fields[i];
        const [nb, ob] = fields[j];
        const ea = oa + RECORD_FIELD_SIZES[na];
        const eb = ob + RECORD_FIELD_SIZES[nb];
        const overlap = oa < eb && ob < ea;
        expect(overlap, `${na}@${oa}+${RECORD_FIELD_SIZES[na]} overlaps ${nb}@${ob}+${RECORD_FIELD_SIZES[nb]}`).toBe(false);
      }
    }
  });

  it('layout and size maps cover identical key sets', () => {
    expect(Object.keys(HEADER_FIELD_SIZES).sort()).toEqual(Object.keys(HEADER_LAYOUT).sort());
    expect(Object.keys(RECORD_FIELD_SIZES).sort()).toEqual(Object.keys(RECORD_LAYOUT).sort());
  });

  it('record fields tile the record contiguously (kind-derived sizes + reserved tail sum to RECORD_SIZE)', () => {
    const fields = (Object.entries(RECORD_LAYOUT) as [keyof typeof RECORD_LAYOUT, number][])
      .sort((a, b) => a[1] - b[1]);
    let expected = 0;
    for (const [name, off] of fields) {
      expect(off, `${name} leaves a gap or overlaps`).toBe(expected);
      expected = off + RECORD_FIELD_SIZES[name];
    }
    expect(expected + RECORD_RESERVED_TAIL_BYTES).toBe(RECORD_SIZE);
  });

  it('magic + version identify the v10 format', () => {
    expect(MAGIC).toBe('HYGA');
    expect(BINARY_VERSION).toBe(10);
  });

  it('record fields cover the v9 byte plan (Apsis 7×float32 at 52..79, sid uint32 at 80, velocity 3×float32 at 84..95, multiplicity uint8 at 96)', () => {
    expect(RECORD_LAYOUT.gaiaSourceId).toBe(44);
    expect(RECORD_LAYOUT.gaiaSourceId + 8).toBe(52); // gaiaSourceId end
    expect(RECORD_SIZE).toBe(100);
    // varType uint8 sits between ampUnits (36) and period (38).
    expect(RECORD_LAYOUT.ampUnits + 1).toBe(RECORD_LAYOUT.varType);
    expect(RECORD_LAYOUT.varType).toBe(37);
    expect(RECORD_LAYOUT.varType + 1).toBe(RECORD_LAYOUT.period);
    expect(RECORD_LAYOUT.period).toBe(38);
    // hip (uint32 at 40) immediately precedes gaiaSourceId.
    expect(RECORD_LAYOUT.hip + 4).toBe(RECORD_LAYOUT.gaiaSourceId);
    // Apsis bank: gspphot (4 floats) then gspspec (3 floats), each 4 bytes,
    // starting immediately after gaiaSourceId at byte 52 and filling the
    // record to RECORD_SIZE.
    expect(RECORD_LAYOUT.teffGspphot).toBe(52);
    expect(RECORD_LAYOUT.loggGspphot).toBe(56);
    expect(RECORD_LAYOUT.mhGspphot).toBe(60);
    expect(RECORD_LAYOUT.azeroGspphot).toBe(64);
    expect(RECORD_LAYOUT.teffGspspec).toBe(68);
    expect(RECORD_LAYOUT.loggGspspec).toBe(72);
    expect(RECORD_LAYOUT.mhGspspec).toBe(76);
    // sid uint32 immediately after the Apsis bank, then the velocity bank.
    expect(RECORD_LAYOUT.mhGspspec + 4).toBe(RECORD_LAYOUT.sid);
    expect(RECORD_LAYOUT.sid).toBe(80);
    // v8 velocity bank: 3 float32 pc/yr appended after sid.
    expect(RECORD_LAYOUT.sid + 4).toBe(RECORD_LAYOUT.vx);
    expect(RECORD_LAYOUT.vx).toBe(84);
    expect(RECORD_LAYOUT.vy).toBe(88);
    expect(RECORD_LAYOUT.vz).toBe(92);
    // v9 multiplicity uint8 after the velocity bank; the reserved tail pads
    // the stride back to a multiple of 4.
    expect(RECORD_LAYOUT.vz + 4).toBe(RECORD_LAYOUT.multiplicityStatus);
    expect(RECORD_LAYOUT.multiplicityStatus).toBe(96);
    expect(RECORD_LAYOUT.multiplicityStatus + 1 + RECORD_RESERVED_TAIL_BYTES).toBe(RECORD_SIZE);
    expect(RECORD_SIZE % 4).toBe(0);
  });

  it('multiplicity enum values are distinct and fit the uint8 field', () => {
    const values = [MULTIPLICITY_SINGLE, MULTIPLICITY_RESOLVED, MULTIPLICITY_UNRESOLVED];
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xff);
    }
    expect(MULTIPLICITY_SINGLE).toBe(0); // zero-fill default = single
  });

  it('FLAGS registry entries are distinct single-bit values', () => {
    const values = Object.values(FLAGS);
    for (const f of values) {
      expect(f).toBeGreaterThan(0);
      expect(f & (f - 1)).toBe(0); // single-bit
    }
    expect(new Set(values).size).toBe(values.length);
  });

  it('FLAG_* aliases match the FLAGS registry', () => {
    expect(FLAG_HAS_NAME).toBe(FLAGS.hasName);
    expect(FLAG_IS_SOL).toBe(FLAGS.isSol);
    expect(FLAG_HAS_BAYER).toBe(FLAGS.hasBayer);
    expect(FLAG_BINARY_COMPANION_ONLY).toBe(FLAGS.binaryCompanionOnly);
    expect(FLAG_BINARY_PRIMARY).toBe(FLAGS.binaryPrimary);
    expect(FLAG_BINARY_COMPANION_SYNTHETIC).toBe(FLAGS.binaryCompanionSynthetic);
  });

  it('RESERVED_FLAG_BITS does not collide with any registered FLAGS value', () => {
    for (const v of Object.values(FLAGS)) {
      expect(v & RESERVED_FLAG_BITS, `FLAGS value 0x${v.toString(16)} collides with RESERVED_FLAG_BITS`).toBe(0);
    }
  });

  it('reserved + used flag bits stay within the uint8 envelope', () => {
    const used = Object.values(FLAGS).reduce((acc, v) => acc | v, 0);
    expect((used | RESERVED_FLAG_BITS) & ~0xff).toBe(0);
  });

  it('name-table layout is two zero padding bytes + (uint16 len, utf-8 bytes) entries', () => {
    expect(NAME_TABLE_PADDING).toBe(2);
    expect(NAME_LENGTH_PREFIX_BYTES).toBe(2);
    // Round-trip a writer-shaped table inline and verify the reader's
    // pointer-walk lands on the right names. Pins the contract without
    // depending on build-catalog.ts or catalog-loader.ts.
    const encoder = new TextEncoder();
    const names = ['Sol', 'α Cen', '日本']; // ascii + 2-byte + 3-byte UTF-8
    const chunks: Uint8Array[] = [new Uint8Array(NAME_TABLE_PADDING)];
    let len = NAME_TABLE_PADDING;
    const expectedOffsets: number[] = [];
    for (const n of names) {
      const bytes = encoder.encode(n);
      expectedOffsets.push(len);
      const lenHeader = new Uint8Array(NAME_LENGTH_PREFIX_BYTES);
      new DataView(lenHeader.buffer).setUint16(0, bytes.length, true);
      chunks.push(lenHeader);
      chunks.push(bytes);
      len += NAME_LENGTH_PREFIX_BYTES + bytes.length;
    }
    const table = new Uint8Array(len);
    let p = 0;
    for (const c of chunks) { table.set(c, p); p += c.length; }
    // Sentinel padding is zero.
    for (let i = 0; i < NAME_TABLE_PADDING; i++) expect(table[i]).toBe(0);
    // Reader walk — the shared decode both readers use.
    const recovered = readNameTable(table.buffer, 0, len);
    expect([...recovered.values()]).toEqual(names);
    expect([...recovered.keys()]).toEqual(expectedOffsets);
    expect(recovered.has(0)).toBe(false); // offset 0 stays the no-name sentinel

    const encoded = encodeNameTable([names[0], null, names[1], '', names[2]]);
    expect(encoded.bytes).toEqual(table);
    expect([...encoded.offsets]).toEqual([expectedOffsets[0], 0, expectedOffsets[1], 0, expectedOffsets[2]]);
    expect(encoded.entries).toBe(3);
  });

  it('encodeNameTable refuses a name past the uint16 length prefix', () => {
    expect(() => encodeNameTable(['x'.repeat(0x10000)])).toThrow(/Name too long/);
  });
});

describe('catalog-pure / record reader surface', () => {
  const DISTINCT: WireStarRecord = {
    x: 1.5, y: -2.25, z: 3.125,
    vx: 1e-5, vy: -2e-5, vz: 3e-5,
    absmag: -1.75, ci: 0.5, physRadius: 12.5,
    companionIdx: 4242, nameOffset: 18,
    spectClass: 3, lumClass: 4, conIndex: 87, flags: 0x15,
    ampUnits: 200, periodUnits: 40_000, varType: VAR_TYPE_ECLIPSING,
    hip: 120_404, gaiaSourceId: 4_658_107_884_688_023_040n,
    apsis: {
      teffGspphot: 5772, loggGspphot: 4.44, mhGspphot: -0.5, azeroGspphot: 0.25,
      teffGspspec: 5800, loggGspspec: 4.5, mhGspspec: 0.1,
    },
    sid: 99_999,
    multiplicityStatus: MULTIPLICITY_RESOLVED,
  };

  const span = (count: number) => ({ offset: HEADER_SIZE, first: 0, end: count });

  function writeOne(record: WireStarRecord, count = 1): DataView {
    const view = new DataView(new ArrayBuffer(HEADER_SIZE + count * RECORD_SIZE));
    for (let i = 0; i < count; i++) writeStarRecord(view, HEADER_SIZE + i * RECORD_SIZE, record);
    return view;
  }

  it('reads back every field writeStarRecord emits', () => {
    const view = writeOne(DISTINCT);
    const off = HEADER_SIZE;
    expect(readRecordField(view, off, 'x')).toBeCloseTo(DISTINCT.x, 5);
    expect(readRecordField(view, off, 'vy')).toBeCloseTo(DISTINCT.vy, 10);
    expect(readRecordField(view, off, 'absmag')).toBeCloseTo(DISTINCT.absmag, 5);
    expect(readRecordField(view, off, 'companion')).toBe(DISTINCT.companionIdx);
    expect(readRecordField(view, off, 'nameOffset')).toBe(DISTINCT.nameOffset);
    expect(readRecordField(view, off, 'conIndex')).toBe(DISTINCT.conIndex);
    expect(readRecordField(view, off, 'flags')).toBe(DISTINCT.flags);
    expect(readRecordField(view, off, 'ampUnits')).toBe(DISTINCT.ampUnits);
    expect(readRecordField(view, off, 'period')).toBe(DISTINCT.periodUnits);
    expect(readRecordField(view, off, 'varType')).toBe(DISTINCT.varType);
    expect(readRecordField(view, off, 'hip')).toBe(DISTINCT.hip);
    expect(readRecordField(view, off, 'sid')).toBe(DISTINCT.sid);
    expect(readRecordField(view, off, 'multiplicityStatus')).toBe(DISTINCT.multiplicityStatus);
    expect(readRecordFieldBig(view, off, 'gaiaSourceId')).toBe(DISTINCT.gaiaSourceId);
  });

  it('every numeric field reads through the getter its declared kind implies', () => {
    // A u8 field read as u16 (or an f32 read as u32) would return a value
    // outside the kind's range or a NaN-shaped float; walking every field
    // catches a LAYOUT/KINDS pair that drifted apart.
    const view = writeOne(DISTINCT);
    for (const [field, kind] of Object.entries(RECORD_FIELD_KINDS)) {
      if (kind === 'u64') continue;
      const v = readRecordField(view, HEADER_SIZE, field as NumericRecordField);
      expect(Number.isFinite(v), `${field} decoded as ${v}`).toBe(true);
      if (kind === 'u8') expect(v, field).toBeLessThanOrEqual(0xff);
      if (kind === 'u16') expect(v, field).toBeLessThanOrEqual(0xffff);
      if (kind === 'u32') expect(v, field).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('decodeRecordColumn agrees with readRecordField field for field', () => {
    const count = 4;
    const view = writeOne(DISTINCT, count);
    for (const [field, kind] of Object.entries(RECORD_FIELD_KINDS)) {
      if (kind === 'u64') continue;
      const out = new Float32Array(count);
      decodeRecordColumn(view, span(count), field as NumericRecordField, out);
      for (let i = 0; i < count; i++) {
        const scalar = readRecordField(view, HEADER_SIZE + i * RECORD_SIZE, field as NumericRecordField);
        expect(out[i], `${field}[${i}]`).toBe(Math.fround(scalar));
      }
    }
    const big = new BigUint64Array(count);
    decodeRecordColumnBig(view, span(count), 'gaiaSourceId', big);
    expect([...big]).toEqual(Array(count).fill(DISTINCT.gaiaSourceId));
  });

  it('decodeRecordColumn interleaves a triple at the given stride + component', () => {
    const count = 3;
    const view = writeOne(DISTINCT, count);
    const positions = new Float32Array(count * 3);
    decodeRecordColumn(view, span(count), 'x', positions, { stride: 3, component: 0 });
    decodeRecordColumn(view, span(count), 'y', positions, { stride: 3, component: 1 });
    decodeRecordColumn(view, span(count), 'z', positions, { stride: 3, component: 2 });
    for (let i = 0; i < count; i++) {
      expect(positions[i * 3 + 0]).toBeCloseTo(DISTINCT.x, 5);
      expect(positions[i * 3 + 1]).toBeCloseTo(DISTINCT.y, 5);
      expect(positions[i * 3 + 2]).toBeCloseTo(DISTINCT.z, 5);
    }
  });

  it('scale de-quantises the amplitude + period bytes back to physical units', () => {
    const view = writeOne(DISTINCT);
    const amp = new Float32Array(1);
    const period = new Float32Array(1);
    decodeRecordColumn(view, span(1), 'ampUnits', amp, { scale: AMP_MAG_PER_UNIT });
    decodeRecordColumn(view, span(1), 'period', period, { scale: PERIOD_DAYS_PER_UNIT });
    expect(amp[0]).toBeCloseTo(10, 6);      // 200 × 0.05 mag
    expect(period[0]).toBeCloseTo(4000, 3); // 40000 × 0.1 d
  });

  it('the quantisation steps are the exact inverse of the encoders', () => {
    // AMP_MAG_PER_UNIT / PERIOD_DAYS_PER_UNIT are the decode-side spelling
    // of encodeAmpUnits / encodePeriodUnits' factors; a drift in either
    // silently rescales every shipped variability value.
    for (const mag of [0, 0.05, 0.35, 1.2, 9.4, 12.75]) {
      expect(encodeAmpUnits(mag) * AMP_MAG_PER_UNIT).toBeCloseTo(mag, 10);
    }
    for (const days of [0, 0.1, 4.4, 146.5, 409.2, 6553.5]) {
      expect(encodePeriodUnits(days) * PERIOD_DAYS_PER_UNIT).toBeCloseTo(days, 10);
    }
  });

  it('readCatalogHeader returns the written header and rejects foreign buffers', () => {
    const buffer = new ArrayBuffer(HEADER_SIZE);
    writeCatalogHeader(new DataView(buffer), {
      count: 7, nameTableOffset: 32, nameTableLength: 2,
    });
    expect(readCatalogHeader(buffer)).toEqual({
      magic: MAGIC,
      version: BINARY_VERSION,
      count: 7,
      nameTableOffset: 32,
      nameTableLength: 2,
    });

    const badMagic = new ArrayBuffer(HEADER_SIZE);
    new Uint8Array(badMagic).set([0x4e, 0x4f, 0x50, 0x45]); // "NOPE"
    expect(() => readCatalogHeader(badMagic)).toThrow(/Bad magic/);

    const oldVersion = new ArrayBuffer(HEADER_SIZE);
    writeCatalogHeader(new DataView(oldVersion), {
      count: 1, nameTableOffset: 32, nameTableLength: 0,
    });
    new DataView(oldVersion).setUint32(HEADER_LAYOUT.version, BINARY_VERSION - 1, true);
    expect(() => readCatalogHeader(oldVersion)).toThrow(/Unsupported catalog version/);
  });
});

describe('catalog-pure / search-index wire contract', () => {
  // The SearchEntry field names ARE the on-disk keys of search-index.json.
  // buildSearchEntry (writer) and src/client/typeahead/search.ts (reader)
  // share the type, so tsc keeps their field access in lockstep — but
  // main.ts ingests the file through an unchecked `as SearchEntry[]` cast,
  // so a rename silently reshapes the persisted wire format (breaking any
  // cached index / external consumer) with no red test. Pin the literal
  // key strings so a rename trips here, mirroring the binary
  // record-layout pin above.
  const SEARCH_ENTRY_KEYS = [
    'i', 'p', 'b', 'bx', 'bc', 'f', 'gd', 'gh', 'c', 'dc', 's', 'g', 'hip',
    'hd', 'hr', 'hda', 'hra', 'gl', 'cl', 'cp', 'al',
  ];

  it('SearchEntry exposes exactly the documented wire keys', () => {
    // Excess-property checking makes a renamed or dropped interface key a
    // compile error on this literal; the runtime assertion pins the names.
    const full: Required<SearchEntry> = {
      i: 0, p: 'Sirius', b: 'α', bx: 1, bc: 'A', f: 9, gd: 268, gh: 'Cau', c: 34,
      dc: 3, s: 'A1V', g: 'R CrB', hip: 32349, hd: 48915, hr: 2491,
      hda: [48916], hra: [2492], gl: 'GJ 244', cl: 'B', cp: 5,
      al: ['Alhabor'],
    };
    expect(Object.keys(full).sort()).toEqual([...SEARCH_ENTRY_KEYS].sort());
  });

  const source = (over: Partial<SearchEntrySource>): SearchEntrySource => ({
    proper: null, bayer: null, bayerSup: null, bayerComponent: null,
    gould: null, gouldHalf: null,
    aliases: [], flam: null, hip: null, hd: null, hr: null,
    hdAlt: [], hrAlt: [], gl: null, gcvsName: null, conIndex: NO_CONSTELLATION_INDEX,
    desigCon: { via: 'none' }, spectDisplay: null, ...over,
  });

  it('buildSearchEntry emits every populated wire key', () => {
    const entry = buildSearchEntry(
      source({
        proper: 'Sirius', bayer: 'α', bayerSup: 1, bayerComponent: 'A',
        flam: 9, gould: 268,
        gouldHalf: 'Cau', aliases: ['Alhabor'], hip: 32349, hd: 48915,
        hr: 2491, hdAlt: [48916], hrAlt: [2492],
        gl: 'GJ 244', gcvsName: 'R CrB', conIndex: 34,
        desigCon: { index: 3 }, spectDisplay: 'A1V',
      }),
      0,
      { comp: 'B', primaryIdx: 5 },
    );
    expect(entry).not.toBeNull();
    expect(Object.keys(entry as SearchEntry).sort())
      .toEqual([...SEARCH_ENTRY_KEYS].sort());
  });

  it('buildSearchEntry omits absent fields — no null/undefined on the wire', () => {
    const entry = buildSearchEntry(source({ hip: 7 }), 3, undefined);
    expect(JSON.parse(JSON.stringify(entry))).toEqual({ i: 3, hip: 7 });
    expect(Object.keys(entry as SearchEntry)).toEqual(['i', 'hip']);
  });

  it('buildSearchEntry drops the unclassified constellation sentinel', () => {
    const entry = buildSearchEntry(
      source({ hip: 7, conIndex: NO_CONSTELLATION_INDEX }), 0, undefined,
    );
    expect(entry).not.toHaveProperty('c');
  });

  it('buildSearchEntry returns null for a star with no typable identifier', () => {
    expect(buildSearchEntry(source({ conIndex: 34 }), 0, undefined)).toBeNull();
  });

  it('buildSearchEntry emits dc only where the designation constellation differs', () => {
    // Agreeing (the overwhelming majority) and unknown-designation records
    // both ride the reader's `dc ?? c` fallback, so neither pays wire cost.
    const agreeing = buildSearchEntry(
      source({ flam: 67, conIndex: 34, desigCon: { index: 34 } }), 0, undefined,
    );
    expect(agreeing).not.toHaveProperty('dc');
    const unknown = buildSearchEntry(
      source({ flam: 67, conIndex: 34, desigCon: { via: 'none' } }), 0, undefined,
    );
    expect(unknown).not.toHaveProperty('dc');
    // ρ Aql's shape: positional Delphinus, designation Aquila.
    const diverging = buildSearchEntry(
      source({ bayer: 'Rho', flam: 67, hip: 99742, conIndex: 31, desigCon: { index: 3 } }),
      0, undefined,
    );
    expect(diverging?.c).toBe(31);
    expect(diverging?.dc).toBe(3);
  });

  it('buildSearchEntry withholds dc from an entry with no constellation-relative designation', () => {
    // A star findable only by HIP/HD/HR/Gl never renders "<designation>
    // <Con>", so carrying the field would be 60-odd bytes of wire for a
    // reader that cannot consult it.
    const byNumber = buildSearchEntry(
      source({ hip: 7, hd: 9, conIndex: 31, desigCon: { index: 3 } }), 0, undefined,
    );
    expect(byNumber).not.toHaveProperty('dc');
    // A component alias composes "<primary designation> <letter>" against
    // this entry's constellation, so it does need it (Fomalhaut C sits in
    // Aquarius but is "α PsA C").
    const component = buildSearchEntry(
      source({ proper: 'Fomalhaut C', conIndex: 4, desigCon: { index: 65 } }),
      0, { comp: 'C', primaryIdx: 5 },
    );
    expect(component?.dc).toBe(65);
  });

  it('designationConIndex prefers the editorial index and falls back to the positional one', () => {
    expect(designationConIndex(3, 31)).toBe(3);
    expect(designationConIndex(NO_CONSTELLATION_INDEX, 31)).toBe(31);
    expect(designationConIndex(undefined, 31)).toBe(31);
    expect(designationConIndex(undefined, undefined)).toBe(NO_CONSTELLATION_INDEX);
  });
});

// ─── Bailer-Jones (DR3) distance override ──────────────────────────────

describe('catalog-pure / NO_APSIS sentinel', () => {
  it('is NaN, distinguishable from every finite Apsis value', () => {
    expect(Number.isNaN(NO_APSIS)).toBe(true);
  });

  it('round-trips through Float32 DataView as NaN', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, NO_APSIS, true);
    expect(Number.isNaN(view.getFloat32(0, true))).toBe(true);
  });

  it('finite values survive Float32 round-trip without becoming the sentinel', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    // Pick values from the bead spec's spot-check stars (Sirius-region
    // Teff ~10000K, K-dwarf logg ~4.5, halo [M/H] ~-1.5, mild A0 ~0.2).
    for (const v of [10000.0, 4.5, -1.5, 0.2]) {
      view.setFloat32(0, v, true);
      const r = view.getFloat32(0, true);
      expect(Number.isNaN(r)).toBe(false);
      expect(r).toBeCloseTo(v, 3);
    }
  });
});

describe('catalog-pure / transport chunking', () => {
  it('planCatalogChunks splits on the target with a short final chunk', () => {
    expect(planCatalogChunks(350, 100)).toEqual([100, 100, 100, 50]);
    expect(planCatalogChunks(200, 100)).toEqual([100, 100]);
    expect(planCatalogChunks(50, 100)).toEqual([50]);
    expect(planCatalogChunks(0, 100)).toEqual([0]);
  });

  it('planCatalogChunks rejects a non-positive target', () => {
    expect(() => planCatalogChunks(100, 0)).toThrow(/Invalid chunk target/);
    expect(() => planCatalogChunks(100, 10, 0)).toThrow(/Invalid first-chunk target/);
  });

  it('planCatalogChunks doubles from the first-chunk target up to the ceiling', () => {
    expect(planCatalogChunks(1000, 64, 4)).toEqual(
      [4, 8, 16, 32, ...Array<number>(14).fill(64), 44],
    );
  });

  it('assembleCatalogChunks throws on chunk-count mismatch', () => {
    const manifest: CatalogManifest = { chunkBytes: [4, 4], totalBytes: 8 };
    expect(() => assembleCatalogChunks([new Uint8Array(4)], manifest)).toThrow(/count mismatch/);
  });

  it('assembleCatalogChunks throws on chunk-length mismatch', () => {
    const manifest: CatalogManifest = { chunkBytes: [4, 4], totalBytes: 8 };
    expect(() =>
      assembleCatalogChunks([new Uint8Array(4), new Uint8Array(3)], manifest),
    ).toThrow(/chunk 1 length mismatch/);
  });

  it('assembleCatalogChunks throws on total-bytes mismatch', () => {
    const manifest: CatalogManifest = { chunkBytes: [4], totalBytes: 8 };
    expect(() => assembleCatalogChunks([new Uint8Array(4)], manifest)).toThrow(/size mismatch/);
  });
});
