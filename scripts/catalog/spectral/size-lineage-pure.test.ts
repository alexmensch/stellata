import { describe, expect, it } from 'vitest';

import {
  ABSMAG_PARAM_DECIMALS, SIZE_CODES, sizeLineageLines, sizeLineageRows, type Size,
} from './size-lineage-pure';
import { SIMBAD_SPTYPE } from './simbad-sptype-source';
import { GAIA_APSIS } from '../record/gaia-apsis-source';
import { decodeLineageLine, paramsOf } from '../lineage/lineage-row-pure';
import { sourceRowRef, sourceRowRefText } from '../../util/sources/row-ref-pure';
import {
  physicalRadius, resolveApsisTeff, type ApsisTeffResolution,
} from '../../../src/catalog-format/spectral/physical-radius';
import { classifyFromGspspec, classifyFromSimbad, SPECTRAL_UNKNOWN } from '../../../src/catalog-format/spectral/spectral-classify';
import type { ApsisRow } from '../../../src/catalog-format/record/catalog-pure';

const KEY = 'gaia-dr3-astrometry:1000';
const SIMBAD_REF = sourceRowRef(SIMBAD_SPTYPE, 42);
const APSIS_REF = sourceRowRef(GAIA_APSIS, '1000');
const APSIS_NONE: ApsisRow = {
  teffGspphot: null, loggGspphot: null, mhGspphot: null, azeroGspphot: null,
  teffGspspec: null, loggGspspec: null, mhGspspec: null, spectraltypeEsphs: null,
};

const apsis = (row: Partial<ApsisRow>): { ref: typeof APSIS_REF; teff: ApsisTeffResolution } => ({
  ref: APSIS_REF, teff: resolveApsisTeff({ ...APSIS_NONE, ...row }),
});

const summary = (s: Size) => sizeLineageRows(s).map((r) => ({
  role: r.role, code: r.code.slice(`${SIZE_CODES.stage}.`.length), params: paramsOf(r), evidence: r.evidence,
}));

describe('sizeLineageRows', () => {
  it('writes the class-table route with the absmag, the class-index reading and the class\'s rows', () => {
    const info = classifyFromSimbad('G2V')!;
    expect(summary({ key: KEY, radius: physicalRadius(4.83, info), apsis: null, classEvidence: [SIMBAD_REF] })).toEqual([{
      role: 'outcome', code: 'class-teff', params: { absmag: (4.83).toFixed(ABSMAG_PARAM_DECIMALS), class_index: 'stated' },
      evidence: [sourceRowRefText(SIMBAD_REF)],
    }]);
  });

  it('writes the Apsis route naming its solution, after each solution refused as out of window', () => {
    const a = apsis({ teffGspphot: 1500, teffGspspec: 5150 });
    const info = classifyFromGspspec('K')!;
    const radius = physicalRadius(5.9, info, a.teff.teff!.kelvin);
    expect(summary({ key: KEY, radius, apsis: a, classEvidence: [APSIS_REF] })).toEqual([
      {
        role: 'refused', code: 'refused.apsis-teff-out-of-window', params: { solution: 'gspphot' },
        evidence: [sourceRowRefText(APSIS_REF)],
      },
      {
        role: 'outcome', code: 'apsis-teff',
        params: { absmag: '5.9000', solution: 'gspspec', class_index: 'default' },
        evidence: [sourceRowRefText(APSIS_REF)],
      },
    ]);
  });

  it('refuses an Apsis Teff a Wolf-Rayet or white dwarf overrides, naming the solution', () => {
    const a = apsis({ teffGspphot: 5000 });
    const wr = physicalRadius(-4, classifyFromSimbad('WN5')!, 5000);
    expect(summary({ key: KEY, radius: wr, apsis: a, classEvidence: [SIMBAD_REF] }).map((r) => [r.code, r.params])).toEqual([
      ['refused.apsis-teff-wolf-rayet', { solution: 'gspphot' }],
      ['class-teff', { absmag: '-4.0000', class_index: 'stated' }],
    ]);
    const wd = physicalRadius(11, classifyFromSimbad('DA2')!, 5000);
    expect(summary({ key: KEY, radius: wd, apsis: a, classEvidence: [SIMBAD_REF] }).map((r) => [r.code, r.params])).toEqual([
      ['refused.apsis-teff-white-dwarf', { solution: 'gspphot' }],
      ['white-dwarf', {}],
    ]);
  });

  it('names the clamp, the unknown class, and the non-finite stand-in', () => {
    const codeParams = (s: Size) => summary(s).map((r) => [r.code, r.params]);
    expect(codeParams({ key: KEY, radius: physicalRadius(30, classifyFromSimbad('M9V')!), apsis: null, classEvidence: [] }))
      .toEqual([['class-teff', { absmag: '30.0000', class_index: 'stated', clamp: 'floor' }]]);
    expect(codeParams({ key: KEY, radius: physicalRadius(4, SPECTRAL_UNKNOWN), apsis: null, classEvidence: [] }))
      .toEqual([['class-teff', { absmag: '4.0000', class_index: 'unknown-class' }]]);
    expect(codeParams({ key: KEY, radius: physicalRadius(-2000, SPECTRAL_UNKNOWN), apsis: null, classEvidence: [] }))
      .toEqual([['non-finite-luminosity', { absmag: '-2000.0000' }]]);
  });

  it('throws on a refusal with no Apsis Teff behind it', () => {
    const wd = physicalRadius(11, classifyFromSimbad('DA2')!, 5000);
    expect(() => sizeLineageRows({ key: KEY, radius: wd, apsis: null, classEvidence: [] })).toThrow(/never handed/);
  });

  it('round-trips through its lines', () => {
    const size: Size = { key: KEY, radius: physicalRadius(4.83, classifyFromSimbad('G2V')!), apsis: null, classEvidence: [SIMBAD_REF] };
    expect(sizeLineageLines(size).map(decodeLineageLine)).toEqual(sizeLineageRows(size));
  });
});
