import { describe, it, expect } from 'vitest';
import type { ApsisRow, SimbadRecordKeys } from '../catalog-pure';
import {
  SPECTRAL_UNKNOWN,
} from './spectral-classify';
import {
  type SimbadSpectralIndex,
  type SimbadSpectralRow,
  parseSimbadSptypeTsv,
  resolveSpectralInfo,
} from './spectral-resolve';

describe('resolveSpectralInfo — tier priority', () => {
  const GAIA_ID = '1234567890';
  const HIP = 14576;
  const APSIS_NONE: ApsisRow = {
    teffGspphot: null, loggGspphot: null, mhGspphot: null, azeroGspphot: null,
    teffGspspec: null, loggGspspec: null, mhGspspec: null, spectraltypeEsphs: null,
  };
  const idx = (
    bySourceId: [string, SimbadSpectralRow][] = [],
    byHip: [number, SimbadSpectralRow][] = [],
    byTyc: [string, SimbadSpectralRow][] = [],
    byGj: [string, SimbadSpectralRow][] = [],
  ): SimbadSpectralIndex => ({
    bySourceId: new Map(bySourceId), byHip: new Map(byHip),
    byTyc: new Map(byTyc), byGj: new Map(byGj),
  });
  const keys = (
    sourceId: string | null, hip: number | null,
    tyc: string | null = null, gl: string | null = null,
  ): SimbadRecordKeys => ({ sourceId, hip, tyc, gl });

  it('tier 0: curated HIP override outranks every machine tier (Castor)', () => {
    // HIP 36850 (Castor A) — SIMBAD '* alf Gem A' carries neither hip
    // nor source_id, so without the curated tier the record is
    // spectral-unknown and the radius chain inflates ~3×.
    const simbad = idx([], [[36850, { spType: 'K0III', spQual: 'C', otype: '**' }]]);
    const out = resolveSpectralInfo(keys(null, 36850), simbad, new Map());
    expect(out.source).toBe('curated');
    expect(out.info.classIdx).toBe(2); // A
    expect(out.info.lumClass).toBe(3); // IV
    expect(out.spectDisplay).toBe('A1.5IV');
  });

  it('tier 1: SIMBAD-by-source_id wins when present and parseable', () => {
    const simbad = idx([[GAIA_ID, { spType: 'A6V', spQual: 'C', otype: 'PM*' }]]);
    const apsis = new Map<string, ApsisRow>([
      [GAIA_ID, { ...APSIS_NONE, spectraltypeEsphs: 'G' }],
    ]);
    const out = resolveSpectralInfo(keys(GAIA_ID, HIP), simbad, apsis);
    expect(out.source).toBe('simbad');
    expect(out.info.classIdx).toBe(2); // A
    expect(out.info.subclass).toBe(6);
    expect(out.info.lumClass).toBe(2); // V
    expect(out.spectDisplay).toBe('A6V');
  });

  it('tier 2: SIMBAD-by-HIP rescues a Gaia-saturated star (no source_id)', () => {
    const simbad = idx([], [[HIP, { spType: 'B8V', spQual: 'C', otype: 'SB*' }]]);
    const out = resolveSpectralInfo(keys(null, HIP), simbad, new Map());
    expect(out.source).toBe('simbad');
    expect(out.info.classIdx).toBe(1); // B
    expect(out.info.subclass).toBe(8);
    expect(out.info.lumClass).toBe(2); // V
    expect(out.spectDisplay).toBe('B8V');
  });

  it('tier 2: SIMBAD-by-HIP beats GSP-Spec (full MK over letter-only enum)', () => {
    const simbad = idx([], [[HIP, { spType: 'A2IV', spQual: 'C', otype: '**' }]]);
    const apsis = new Map<string, ApsisRow>([
      [GAIA_ID, { ...APSIS_NONE, spectraltypeEsphs: 'K' }],
    ]);
    const out = resolveSpectralInfo(keys(GAIA_ID, HIP), simbad, apsis);
    expect(out.source).toBe('simbad');
    expect(out.info.classIdx).toBe(2); // A, not K
    expect(out.info.lumClass).toBe(3); // IV
  });

  it('tier 3: SIMBAD-by-TYC reaches an object SIMBAD holds no Gaia id for', () => {
    const simbad = idx([], [], [['1234-5678-1', { spType: 'K2III', spQual: 'C', otype: '*' }]]);
    const out = resolveSpectralInfo(keys(GAIA_ID, HIP, '1234-5678-1', null), simbad, new Map());
    expect(out.source).toBe('simbad');
    expect(out.simbadKey).toBe('tyc');
    expect(out.info.classIdx).toBe(5); // K
    expect(out.spectDisplay).toBe('K2III');
  });

  it('tier 3: SIMBAD-by-TYC beats GSP-Spec, and loses to the source_id tier', () => {
    const apsis = new Map<string, ApsisRow>([
      [GAIA_ID, { ...APSIS_NONE, spectraltypeEsphs: 'F' }],
    ]);
    const tycOnly = idx([], [], [['1-2-1', { spType: 'M4V', spQual: 'C', otype: '*' }]]);
    expect(resolveSpectralInfo(keys(GAIA_ID, null, '1-2-1', null), tycOnly, apsis).info.classIdx)
      .toBe(6); // M, not F
    const both = idx(
      [[GAIA_ID, { spType: 'A0V', spQual: 'C', otype: '*' }]], [],
      [['1-2-1', { spType: 'M4V', spQual: 'C', otype: '*' }]],
    );
    const out = resolveSpectralInfo(keys(GAIA_ID, null, '1-2-1', null), both, apsis);
    expect(out.simbadKey).toBe('source_id');
    expect(out.info.classIdx).toBe(2); // A
  });

  it('tier 4: SIMBAD-by-GJ, matched on the folded key not the raw cell', () => {
    const simbad = idx([], [], [], [['165A', { spType: 'M2V', spQual: 'C', otype: '*' }]]);
    for (const spelling of ['Gl 165A', 'GJ 165A', '165 A']) {
      const out = resolveSpectralInfo(keys(null, null, null, spelling), simbad, new Map());
      expect(out.simbadKey, spelling).toBe('gj');
      expect(out.info.classIdx).toBe(6); // M
    }
  });

  it('every SIMBAD tier reports the namespace that found it, in ladder order', () => {
    const simbad = idx(
      [[GAIA_ID, { spType: 'A0V', spQual: 'C', otype: '*' }]],
      [[HIP, { spType: 'B8V', spQual: 'C', otype: '*' }]],
      [['1-2-1', { spType: 'M4V', spQual: 'C', otype: '*' }]],
      [['165A', { spType: 'K0V', spQual: 'C', otype: '*' }]],
    );
    const key = (
      sid: string | null, hip: number | null, tyc: string | null, gl: string | null,
    ): string | undefined =>
      resolveSpectralInfo(keys(sid, hip, tyc, gl), simbad, new Map()).simbadKey;
    expect(key(GAIA_ID, HIP, '1-2-1', 'Gl 165A')).toBe('source_id');
    expect(key(null, HIP, '1-2-1', 'Gl 165A')).toBe('hip');
    // GJ names the component, TYC the Tycho entry — the system on a close
    // pair — so a record holding both takes the component type, not the blend.
    expect(key(null, null, '1-2-1', 'Gl 165A')).toBe('gj');
    expect(key(null, null, '1-2-1', null)).toBe('tyc');
    expect(key(null, null, null, null)).toBeUndefined();
  });

  it('tier 5: GSP-Spec when SIMBAD is absent or unparseable', () => {
    const apsis = new Map<string, ApsisRow>([
      [GAIA_ID, { ...APSIS_NONE, spectraltypeEsphs: 'K' }],
    ]);
    const out = resolveSpectralInfo(keys(GAIA_ID, HIP), idx(), apsis);
    expect(out.source).toBe('gspspec');
    expect(out.info.classIdx).toBe(5); // K
    expect(out.spectDisplay).toBe('K');
  });

  it('tier 5 fires when SIMBAD sp_type is present but unparseable', () => {
    const simbad = idx([[GAIA_ID, { spType: 'PEC', spQual: 'E', otype: 'V*' }]]);
    const apsis = new Map<string, ApsisRow>([
      [GAIA_ID, { ...APSIS_NONE, spectraltypeEsphs: 'F' }],
    ]);
    const out = resolveSpectralInfo(keys(GAIA_ID, HIP), simbad, apsis);
    expect(out.source).toBe('gspspec');
    expect(out.info.classIdx).toBe(3); // F
  });

  it('tier 6: SPECTRAL_UNKNOWN fallback when every upstream tier misses', () => {
    const out = resolveSpectralInfo(keys(GAIA_ID, HIP), idx(), new Map());
    expect(out.source).toBe('fallback');
    expect(out.info).toBe(SPECTRAL_UNKNOWN);
    expect(out.spectDisplay).toBeNull();
  });

  it('tier 6: no source_id and no HIP falls straight through to fallback', () => {
    const simbad = idx([['9999', { spType: 'A0V', spQual: 'C', otype: 'PM*' }]]);
    const out = resolveSpectralInfo(keys(null, null), simbad, new Map());
    expect(out.source).toBe('fallback');
    expect(out.info).toBe(SPECTRAL_UNKNOWN);
  });
});

describe('parseSimbadSptypeTsv', () => {
  const HDR =
    'simbad_oid\tsimbad_main_id\tsp_type\tsp_qual\tsp_bibcode\totype\thip\tsource_id\n';

  it('parses canonical rows into bySourceId and byHip', () => {
    const tsv = HDR +
      '57848\t*  56 Cyg\tA6V\tC\t1995ApJS...99..135A\tPM*\t102843\t2067050940754838656\n' +
      '370513\tHD  47606\tkA6hA7mF1(III)\tD\t2020AJ....160...52M\t*\t32151\t1001011023904917760\n';
    const { bySourceId, byHip } = parseSimbadSptypeTsv(tsv);
    expect(bySourceId.size).toBe(2);
    expect(byHip.size).toBe(2);
    const a = bySourceId.get('2067050940754838656');
    expect(a?.spType).toBe('A6V');
    expect(a?.spQual).toBe('C');
    expect(a?.otype).toBe('PM*');
    expect(byHip.get(102843)).toBe(a);
    const b = bySourceId.get('1001011023904917760');
    expect(b?.spType).toBe('kA6hA7mF1(III)');
  });

  it('indexes a blank-source_id row by HIP (Gaia-saturated bright stars)', () => {
    const tsv = HDR +
      '51431\t* bet Per\tB8V\tC\t\tSB*\t14576\t\n' +
      '999\tBlank\t\t\t\t\t\t1234\n';
    const { bySourceId, byHip } = parseSimbadSptypeTsv(tsv);
    expect(bySourceId.size).toBe(1);
    expect(bySourceId.has('1234')).toBe(true);
    expect(byHip.size).toBe(1);
    expect(byHip.get(14576)?.spType).toBe('B8V');
  });

  it('drops rows with no source_id, HIP or TYC', () => {
    const tsv = HDR + '42\tNo keys\tG2V\t\t\t\t\t\n';
    const { bySourceId, byHip, byTyc } = parseSimbadSptypeTsv(tsv);
    expect(bySourceId.size).toBe(0);
    expect(byHip.size).toBe(0);
    expect(byTyc.size).toBe(0);
  });

  it('indexes by TYC, keeping a row SIMBAD gives no Gaia id or HIP', () => {
    const tsv =
      'simbad_oid\tsimbad_main_id\tsp_type\tsp_qual\tsp_bibcode\totype\thip\tsource_id\ttyc\tgj\n' +
      '7\tTYC only\tK2III\tC\t\t*\t\t\t1234-5678-1\t\n';
    const { bySourceId, byHip, byTyc } = parseSimbadSptypeTsv(tsv);
    expect(bySourceId.size).toBe(0);
    expect(byHip.size).toBe(0);
    expect(byTyc.get('1234-5678-1')?.spType).toBe('K2III');
  });

  it('a file predating the tyc column parses with an empty byTyc', () => {
    const tsv = HDR +
      '57848\t*  56 Cyg\tA6V\tC\t1995ApJS...99..135A\tPM*\t102843\t2067050940754838656\n';
    const { bySourceId, byTyc } = parseSimbadSptypeTsv(tsv);
    expect(bySourceId.size).toBe(1);
    expect(byTyc.size).toBe(0);
  });

  it('throws rather than pick a winner when a key repeats', () => {
    // The committed pull has no repeated key in any of the four namespaces, so
    // a collision is an upstream schema change. Silently keeping one row is how
    // a record ends up reading its spectral type off the wrong SIMBAD object.
    const dupHip = HDR +
      '1\tFirst\tB8V\tC\t\t*\t14576\t\n' +
      '2\tSecond\tK0III\tD\t\t*\t14576\t\n';
    expect(() => parseSimbadSptypeTsv(dupHip)).toThrow(/two rows keyed hip=14576/);
    const dupSource = HDR +
      '1\tFirst\tB8V\tC\t\t*\t\t9876\n' +
      '2\tSecond\tK0III\tD\t\t*\t\t9876\n';
    expect(() => parseSimbadSptypeTsv(dupSource))
      .toThrow(/two rows keyed source_id=9876/);
    const WIDE =
      'simbad_oid\tsimbad_main_id\tsp_type\tsp_qual\tsp_bibcode\totype\thip\tsource_id\ttyc\tgj\n';
    expect(() => parseSimbadSptypeTsv(WIDE +
      '1\tA\tB8V\tC\t\t*\t\t\t1-2-1\t\n' +
      '2\tB\tK0III\tD\t\t*\t\t\t1-2-1\t\n')).toThrow(/two rows keyed tyc=1-2-1/);
    // The GJ collision is only visible after the fold: `Gl 165A` and `165 A`
    // are one key, which a raw-cell comparison would miss.
    expect(() => parseSimbadSptypeTsv(WIDE +
      '1\tA\tB8V\tC\t\t*\t\t\t\tGl 165A\n' +
      '2\tB\tK0III\tD\t\t*\t\t\t\t165 A\n')).toThrow(/two rows keyed gj=165A/);
  });

  it('decodes blank sp_type / sp_qual / otype cells as null', () => {
    const tsv = HDR + '111\t*\t\t\t\t\t\t9876\n';
    const { bySourceId } = parseSimbadSptypeTsv(tsv);
    const r = bySourceId.get('9876');
    expect(r?.spType).toBeNull();
    expect(r?.spQual).toBeNull();
    expect(r?.otype).toBeNull();
  });

  it('throws on missing required columns', () => {
    expect(() => parseSimbadSptypeTsv('simbad_oid\tsource_id\n1\t9876\n'))
      .toThrow(/sp_type/);
  });
});
