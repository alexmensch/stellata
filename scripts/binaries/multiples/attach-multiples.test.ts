import { describe, expect, it } from 'vitest';

import { UNRESOLVED_ASTROMETRY } from '../astrometry/routes-pure';
import { componentKey } from '../component-tokens-pure';
import { athygRow, gaia5pRow } from '../load/load-fixture';
import { mscPairKey } from '../load/msc-pure';
import { ORBIT_VIA_ON_FILE, type MultiplesRecord } from '../multiples-record-pure';
import { indices, xid } from '../resolve/resolve-fixture';
import { stage6Counts } from './attach-multiples';
import { stage6Report } from './stage6-report-pure';
import { elements, measured, runStage6 } from './stage6-fixture';

const UNRESOLVED_PAIR = [UNRESOLVED_ASTROMETRY, UNRESOLVED_ASTROMETRY] as const;
const sides = (p: string | null, s: string | null) => ({
  primary: { gaiaSourceId: p, resolveVia: 'orb6_hip' as const },
  secondary: { gaiaSourceId: s, resolveVia: 'orb6_hip' as const },
});
const row = (rows: readonly MultiplesRecord[], systemId: string, comp: string): MultiplesRecord =>
  rows.find((r) => r.systemId === systemId && r.comp === comp)!;

describe('attachStage6 — the pair walk', () => {
  it('drops a pair Stage 5 classified optical', () => {
    expect(runStage6([{ ...sides('1', '2'), optical: 'gaia_rejected' }]).rows).toEqual([]);
  });

  it('emits two rows per physical pair, primary first', () => {
    const { rows } = runStage6([{
      primary: { gaiaSourceId: '1', resolveVia: 'orb6_hip' }, secondary: { gaiaSourceId: '2', resolveVia: 'athyg_gaia_native' },
    }]);
    expect(rows.map((r) => [r.systemId, r.comp, r.orbitRole, r.resolveVia])).toEqual([
      ['WDS-1-AB', 'A', 'primary', 'orb6_hip'],
      ['WDS-1-AB', 'B', 'secondary', 'athyg_gaia_native'],
    ]);
  });

  it('drops, and records, a pair with no position on either side and no system anchor', () => {
    const result = runStage6([{ ...sides('1', '2'), astrometry: UNRESOLVED_PAIR }]);
    expect([result.rows, result.droppedNoPosition]).toEqual([[], ['WDS-1AB']]);
  });

  it('surfaces the HD of the component\'s AT-HYG row (ξ UMa)', () => {
    const { rows } = runStage6([sides('1', '2')], indices({ athyg: [athygRow({ gaia: '1', hd: 98231 }), athygRow({ gaia: '2' })] }));
    expect(rows.map((r) => r.hd)).toEqual([98231, null]);
  });

  it('falls back to the HD Stage 2 stashed from the ORB6 entry', () => {
    const { rows } = runStage6([{ primary: { gaiaSourceId: '1', resolveVia: 'orb6_hip', hip: 55203, hd: 98231 } }]);
    expect(rows[0].hd).toBe(98231);
  });

  it('places a pair with no position of its own at the system anchor (40 Eri BC)', () => {
    const W = '04153-0739';
    const { rows } = runStage6([
      { pair: { wdsId: W, components: 'AB' }, ...sides('1', '2'), astrometry: [measured({ raDeg: 0 }), UNRESOLVED_ASTROMETRY] },
      { pair: { wdsId: W, components: 'BC' }, ...sides('3', '4'), astrometry: UNRESOLVED_PAIR },
    ], indices({ simbadWdsSpectra: new Map([[componentKey(W, 'B'), 'DA2.9']]) }));
    expect(rows).toHaveLength(4);
    const bcB = row(rows, `${W}-BC`, 'B');
    expect([bcB.spect, bcB.spectVia, bcB.astrometryVia]).toEqual(['DA2.9', 'simbad', 'system_inherited']);
    expect(bcB.distPc).toBeCloseTo(100.0, 6);
    expect(row(rows, `${W}-AB`, 'B').astrometryVia).toBe('system_inherited');
    expect(row(rows, `${W}-AB`, 'A').astrometryVia).toBe('gaia_5p');
  });

  it('prefers SIMBAD\'s per-component type over AT-HYG\'s system string (40 Eri)', () => {
    const W = '04153-0739';
    const { rows } = runStage6([{ pair: { wdsId: W }, ...sides('1', '2') }], indices({
      athyg: [athygRow({ hip: 19849, gaia: '1', absmag: 4.4, spect: 'K0V' }), athygRow({ gaia: '2', absmag: 11.2, spect: 'K0V' })],
      simbadWdsSpectra: new Map([[componentKey(W, 'A'), 'K0V'], [componentKey(W, 'B'), 'DA2.9']]),
    }));
    expect(rows.map((r) => [r.spect, r.spectVia])).toEqual([['K0V', 'simbad'], ['DA2.9', 'simbad']]);
  });

  it('falls back to AT-HYG\'s type, then to none', () => {
    const athyg = indices({ athyg: [athygRow({ gaia: '10', spect: 'G2V' }), athygRow({ gaia: '20', spect: 'G2V' })] });
    expect(runStage6([sides('10', '20')], athyg).rows.map((r) => [r.spect, r.spectVia])).toEqual([['G2V', 'athyg'], ['G2V', 'athyg']]);
    expect([runStage6([sides('1', '2')]).rows[0]].map((r) => [r.spect, r.spectVia])).toEqual([['', 'none']]);
  });

  it('carries the legacy regime of each orbit route', () => {
    const regimes = ORBIT_VIA_ON_FILE.map((orbitVia) =>
      [orbitVia, runStage6([{ ...sides('1', '2'), orbit: { orbitVia, elements: elements() } }]).rows.map((r) => r.regime)]);
    expect(regimes).toEqual([['orb6', [2, 2]], ['gaia_nss', [2, 2]], ['orb6_spectroscopic', [3, 3]], ['msc', [3, 3]]]);
    expect(runStage6([sides('1', '2')]).rows.map((r) => r.regime)).toEqual([0, 0]);
  });

  it('carries the pair\'s published ρ, θ, year and Δmag on both rows (Sirius)', () => {
    const { rows } = runStage6([{ pair: { rhoLast: 8.502, thetaLast: 174.5, dateLast: 2015, magPri: 1.46, magSec: 8.49 }, ...sides('1', '2') }]);
    for (const r of rows) {
      expect([r.sepArcsec, r.paDeg]).toEqual([8.502, 174.5]);
      expect(r.sepPaEpochJd).toBeCloseTo(2457023.75, 4);
      expect(r.dmag).toBeCloseTo(7.03, 4);
    }
  });

  it('leaves missing pair geometry empty', () => {
    const { rows } = runStage6([{ pair: { rhoLast: null, thetaLast: null, dateLast: null, magPri: null, magSec: null }, ...sides('1', '2') }]);
    for (const r of rows) expect([r.sepArcsec, r.paDeg, r.sepPaEpochJd, r.dmag]).toEqual([null, null, null, null]);
  });
});

describe('attachStage6 — photometry_via', () => {
  it('tags each component\'s own AT-HYG row athyg_own', () => {
    const { rows } = runStage6([sides('1', '2')], indices({ athyg: [athygRow({ gaia: '1' }), athygRow({ gaia: '2' })] }));
    expect(rows.map((r) => r.photometryVia)).toEqual(['athyg_own', 'athyg_own']);
  });

  it('tags a secondary sharing the primary\'s AT-HYG row inherited (Sirius)', () => {
    const shared = { gaiaSourceId: null, hip: 32349, resolveVia: 'unresolved' as const };
    const { rows } = runStage6([{ primary: shared, secondary: shared }], indices({ athyg: [athygRow({ hip: 32349 })] }));
    expect(rows.map((r) => r.photometryVia)).toEqual(['athyg_own', 'athyg_system_inherited']);
  });

  it('tags a row with no AT-HYG row and no Gaia photometry none', () => {
    expect(runStage6([sides('1', '2')]).rows.map((r) => r.photometryVia)).toEqual(['none', 'none']);
  });

  it('derives a secondary\'s photometry from its own Gaia 5p row when AT-HYG has none', () => {
    const { rows } = runStage6([sides('1', '2')], indices({
      athyg: [athygRow({ gaia: '1' })],
      srcToAstrometry: new Map([['2', gaia5pRow({ sourceId: '2', parallaxMas: 10.0, gMag: 8.0, bpMag: 8.6, rpMag: 7.4 })]]),
    }));
    expect(rows[1].photometryVia).toBe('gaia_photometry');
    expect([rows[1].absmag, rows[1].ci].every((v) => v !== null)).toBe(true);
  });

  it('derives nothing for a source the exclusions removed from the astrometry map', () => {
    const { rows } = runStage6([sides('1', '2')], indices({ athyg: [athygRow({ gaia: '1' })] }));
    expect([rows[1].photometryVia, rows[1].absmag]).toEqual(['none', null]);
  });

  it('prefers AT-HYG\'s photometry over Gaia\'s', () => {
    const { rows } = runStage6([sides('1', '2')], indices({
      athyg: [athygRow({ gaia: '1' }), athygRow({ gaia: '2' })],
      srcToAstrometry: new Map([['2', gaia5pRow({ sourceId: '2', gMag: 8.0, bpMag: 8.6, rpMag: 7.4 })]]),
    }));
    expect(rows[1].photometryVia).toBe('athyg_own');
  });

  it('derives nothing for a side not on its own Gaia 5p fit', () => {
    const { rows } = runStage6([{ ...sides('1', '2'), astrometry: [measured(), measured({ astrometryVia: 'hip2_long_baseline' })] }], indices({
      athyg: [athygRow({ gaia: '1' })],
      srcToAstrometry: new Map([['2', gaia5pRow({ sourceId: '2', gMag: 8.0, bpMag: 8.6, rpMag: 7.4 })]]),
    }));
    expect([rows[1].photometryVia, rows[1].absmag]).toEqual(['none', null]);
  });

  it('derives nothing for a source blended into an AT-HYG-backed partner', () => {
    const { rows } = runStage6([{
      primary: { gaiaSourceId: '1', hip: 100, resolveVia: 'orb6_hip' }, secondary: { gaiaSourceId: '1', resolveVia: 'orb6_hip' },
    }], indices({
      athyg: [athygRow({ hip: 100 })],
      srcToAstrometry: new Map([['1', gaia5pRow({ sourceId: '1', gMag: 8.0, bpMag: 8.6, rpMag: 7.4 })]]),
    }));
    expect([rows[1].photometryVia, rows[1].absmag]).toEqual(['none', null]);
  });
});

describe('attachStage6 — q and the estimated elements', () => {
  const athygPair = (primarySpect: string, secondarySpect: string | null) => indices({
    athyg: [
      athygRow({ gaia: '1', distPc: 10, spect: primarySpect }),
      ...(secondarySpect === null ? [] : [athygRow({ gaia: '2', distPc: 10, spect: secondarySpect })]),
    ],
  });
  const at100 = { astrometry: [measured({ parallaxMas: 100 }), measured({ parallaxMas: 100 })] as const };
  const orb6Visual = elements({ pDays: 29133.07, e: 0.5, aAu: 23.0, iRad: 1.0, periastronRad: 0.2, nodeRad: 0.3, distancePc: 1.3 });
  const nss = elements({ pDays: 1.0, e: 0.1, aAu: 0.1, iRad: 1.0, periastronRad: 0.2, nodeRad: 0.3, q: 0.85, distancePc: 26.2 });

  it('fills a visual orbit\'s q from both spectral types (α Cen)', () => {
    const { rows } = runStage6([{ ...sides('1', '2'), ...at100, orbit: { orbitVia: 'orb6', elements: orb6Visual } }], athygPair('G2V', 'K1V'));
    expect(rows[0].q).toBe(rows[1].q);
    expect(rows[0].q).toBeCloseTo(0.432, 2);
  });

  it('keeps a q the orbit published, whatever the types would estimate', () => {
    const { rows } = runStage6([{ ...sides('1', '2'), ...at100, orbit: { orbitVia: 'gaia_nss', elements: nss } }], athygPair('F0V', 'A5V'));
    expect(rows.map((r) => r.q)).toEqual([0.85, 0.85]);
  });

  it('leaves a visual orbit\'s q empty when a type is missing', () => {
    const { rows } = runStage6([{ ...sides('1', '2'), ...at100, orbit: { orbitVia: 'orb6', elements: orb6Visual } }], athygPair('G2V', null));
    expect(rows.map((r) => r.q)).toEqual([null, null]);
  });

  it('defaults an NSS orbit\'s q when a type is missing, and estimates its a', () => {
    const orbit = { orbitVia: 'gaia_nss' as const, elements: elements({ pDays: 12.5, periastronRad: 0.2 }) };
    const { rows } = runStage6([{ ...sides('1', '2'), ...at100, orbit }], athygPair('G2V', null));
    expect(rows.map((r) => r.q)).toEqual([1 / 3, 1 / 3]);
    expect(rows[0].aVia).toBe('kepler_mass_estimate');
  });

  it('fills no q without an orbit', () => {
    expect(runStage6([{ ...sides('1', '2'), ...at100 }], athygPair('G2V', 'K0V')).rows.map((r) => r.q)).toEqual([null, null]);
  });
});

describe('attachStage6 — MSC magnitudes', () => {
  const msc = indices({ mscPairMags: new Map([[mscPairKey('WDS-1', 'Aa', 'Ab'), { vmagPri: 5.02, vmagSec: 7.42 }]]) });

  it('fills a pair\'s magnitudes from the MSC when WDS prints none, and records it', () => {
    const result = runStage6([{ pair: { components: 'Aa,Ab', magPri: null, magSec: null }, ...sides('1', '1'), optical: 'orbit_kept' }], msc);
    for (const r of result.rows) {
      expect([r.magPri, r.magSec]).toEqual([5.02, 7.42]);
      expect(r.dmag).toBeCloseTo(2.4, 7);
    }
    expect(result.mscMagFills).toEqual(['WDS-1Aa,Ab']);
  });

  it('never overwrites the WDS magnitudes', () => {
    const { rows } = runStage6([{ pair: { components: 'Aa,Ab', magPri: 4.0, magSec: 6.0 }, ...sides('1', '1'), optical: 'orbit_kept' }], msc);
    expect([rows[0].magPri, rows[0].magSec]).toEqual([4.0, 6.0]);
  });
});

describe('attachStage6 — standalone components', () => {
  const W = '11111+1111';
  const xids = new Map([
    [componentKey(W, 'A'), xid(W, 'A', '1')],
    [componentKey(W, 'B'), xid(W, 'B', '2')],
    [componentKey(W, 'C'), { ...xid(W, 'C', '3', 42), simbadMainId: '* C' }],
  ]);

  it('emits a SIMBAD-known component no pair reached, at its system anchor', () => {
    const { rows } = runStage6(
      [{ pair: { wdsId: W }, ...sides('1', '2'), astrometry: [measured({ raDeg: 0 }), measured({ raDeg: 0 })] }],
      indices({ simbadWdsSpectra: new Map([[componentKey(W, 'C'), 'M5V']]) }),
      xids,
    );
    expect(rows).toHaveLength(3);
    const c = row(rows, `${W}-_C`, 'C');
    expect([c.orbitRole, c.source, c.spect, c.spectVia, c.regime, c.hip, c.gaiaSourceId, c.astrometryVia, c.photometryVia]).toEqual([
      'standalone', 'simbad', 'M5V', 'simbad', 0, 42, '3', 'system_inherited', 'none',
    ]);
    expect(c.distPc).toBeCloseTo(100.0, 6);
    expect([c.sepArcsec, c.paDeg, c.sepPaEpochJd, c.dmag]).toEqual([null, null, null, null]);
  });

  it('skips a component the pair walk emitted', () => {
    const { rows } = runStage6([{ pair: { wdsId: W }, ...sides('1', '2') }], indices(), new Map([...xids].slice(0, 2)));
    expect(rows.map((r) => r.orbitRole)).toEqual(['primary', 'secondary']);
  });

  it('emits a position-less row when neither Gaia nor the system places it', () => {
    const { rows } = runStage6([], indices(), new Map([[componentKey('99999+9999', 'X'), xid('99999+9999', 'X', null)]]));
    expect(rows.map((r) => [r.systemId, r.distPc, r.astrometryVia])).toEqual([['99999+9999-_X', null, 'unresolved']]);
  });
});

describe('stage6Counts and stage6Report', () => {
  const result = runStage6([
    { ...sides('1', '2'), orbit: { orbitVia: 'gaia_nss', elements: elements() } },
    { pair: { components: 'AC' }, ...sides('1', '3'), optical: 'gaia_rejected' },
    { pair: { wdsId: 'WDS-2' }, ...sides('4', '5'), astrometry: UNRESOLVED_PAIR },
  ], indices(), new Map([[componentKey('WDS-1', 'D'), xid('WDS-1', 'D', null)]]));

  it('counts what the snapshot pins, every closed set zero-filled', () => {
    const counts = stage6Counts(result);
    expect(counts).toMatchObject({
      multiples_rows_emitted: 3, multiples_pairs_dropped_no_position: 1, multiples_standalone_emitted: 1,
      multiples_astrometry_system_inherited: 1, multiples_orbit_q_populated: 2, multiples_sep_arcsec_populated: 2,
      a_via_kepler_mass_estimate: 2, a_via_none: 1, a_via_catalog: 0, spect_none: 3, msc_pair_mags_filled: 0,
    });
  });

  it('logs the fill, the dropped sample, the row split and the spect provenance', () => {
    expect(stage6Report(result)).toEqual([
      'filled pair mags from MSC pair-side V magnitudes on 0 pairs',
      'position-less pair drops: kept pairs with no astrometry and no system anchor never reach multiples.tsv: 1 pairs (sample: WDS-2AB)',
      'multiples.tsv: 3 component rows (1 physical pairs + 1 standalone rows)',
      'spect provenance: curated=0, simbad=0, msc=0, athyg=0, none=3',
    ]);
  });
});
