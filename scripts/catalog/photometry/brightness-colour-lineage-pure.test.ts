import { describe, expect, it } from 'vitest';

import {
  AV_PARAM_DECIMALS,
  BRIGHTNESS_COLOUR_CODES,
  brightnessColourLineageLines,
  brightnessColourLineageRows,
  type BrightnessColour,
} from './brightness-colour-lineage-pure';
import { PHOTOMETRY_REF } from './photometry-fixture';
import { GAIA_GSPC } from './gspc-source';
import { HIP_PHOTOMETRY } from './hip-photometry-source';
import { GAIA_APSIS } from '../record/gaia-apsis-source';
import { SIMBAD_SPTYPE } from '../spectral/simbad-sptype-source';
import { curatedSpectralValue } from '../spectral/spectral-resolve';
import { decodeLineageLine, paramsOf } from '../lineage/lineage-row-pure';
import { sourceRowRef, sourceRowRefText } from '../../util/sources/row-ref-pure';

const KEY = 'gaia-dr3-astrometry:1000';
const HIP_REF = sourceRowRef(HIP_PHOTOMETRY, 7);
const SIMBAD_REF = sourceRowRef(SIMBAD_SPTYPE, 42);
const OTHER_SIMBAD_REF = sourceRowRef(SIMBAD_SPTYPE, 43);
const APSIS_REF = sourceRowRef(GAIA_APSIS, '1000');
const GSPC_REF = sourceRowRef(GAIA_GSPC, '1000');
const G2V = curatedSpectralValue('G2V', (m) => { throw new Error(m); });

const summary = (b: BrightnessColour) => brightnessColourLineageRows(b).map((r) => ({
  role: r.role, code: r.code.slice(`${BRIGHTNESS_COLOUR_CODES.stage}.`.length), params: paramsOf(r), evidence: r.evidence,
}));

describe('brightnessColourLineageRows', () => {
  it('writes the V cascade alone for a row a later placement step parked, refusals first', () => {
    expect(summary({
      kind: 'v-only', key: 'spine:9',
      v: { via: 'none', refusals: [{ tier: 'gaia_riello', reason: 'uncalibrated', ref: PHOTOMETRY_REF }] },
    })).toEqual([
      {
        role: 'refused', code: 'v.refused.uncalibrated', params: { tier: 'gaia_riello' },
        evidence: [sourceRowRefText(PHOTOMETRY_REF)],
      },
      { role: 'outcome', code: 'v.none', params: {}, evidence: [] },
    ]);
  });

  it('writes every step of a shipped record, each citing its rows and never the origin row', () => {
    expect(summary({
      kind: 'shipped', key: KEY,
      v: {
        via: 'printed_hip', value: 2.5, evidence: [HIP_REF],
        refusals: [{ tier: 'gaia_riello', reason: 'colour_out_of_range', ref: PHOTOMETRY_REF }],
      },
      spectral: {
        via: 'simbad', value: { ...G2V, namespace: 'hip' }, evidence: [SIMBAD_REF],
        refusals: [{ tier: 'simbad', reason: 'gaia_id_contradicts', ref: OTHER_SIMBAD_REF, namespace: 'source_id' }],
      },
      ci: {
        via: 'spectral_derived', value: 0.65, evidence: [SIMBAD_REF],
        refusals: [{ tier: 'gspc', reason: 'colour_out_of_range', ref: GSPC_REF }],
      },
      dust: { av: 0.123456, ciDereddened: false },
    })).toEqual([
      // The Gaia row IS the origin row here, so the refusal cites nothing else.
      { role: 'refused', code: 'v.refused.colour-out-of-range', params: { tier: 'gaia_riello' }, evidence: [] },
      { role: 'outcome', code: 'v.printed-hip', params: {}, evidence: [sourceRowRefText(HIP_REF)] },
      {
        role: 'refused', code: 'spectral.refused.gaia-id-contradicts',
        params: { tier: 'simbad', namespace: 'source_id' }, evidence: [sourceRowRefText(OTHER_SIMBAD_REF)],
      },
      { role: 'outcome', code: 'spectral.simbad', params: { namespace: 'hip' }, evidence: [sourceRowRefText(SIMBAD_REF)] },
      { role: 'refused', code: 'ci.refused.colour-out-of-range', params: { tier: 'gspc' }, evidence: [sourceRowRefText(GSPC_REF)] },
      { role: 'outcome', code: 'ci.spectral-derived', params: {}, evidence: [sourceRowRefText(SIMBAD_REF)] },
      { role: 'outcome', code: 'dust.edenhofer2024.absmag-only', params: { av: '0.1235' }, evidence: [] },
    ]);
  });

  it('names the de-reddened colour, and writes no dust row where no grid ran', () => {
    const shipped = (dust: { av: number; ciDereddened: boolean } | null): BrightnessColour => ({
      kind: 'shipped', key: KEY,
      v: { via: 'curated', value: -26.74, evidence: [], refusals: [] },
      spectral: { via: 'gspspec', value: G2V, evidence: [APSIS_REF], refusals: [] },
      ci: {
        via: 'printed_hip_bv', value: 0.65, evidence: [HIP_REF],
        refusals: [{ tier: 'gaia_relation', reason: 'uncalibrated', ref: PHOTOMETRY_REF }],
      },
      dust,
    });
    expect(summary(shipped({ av: 0, ciDereddened: true })).at(-1))
      .toEqual({ role: 'outcome', code: 'dust.edenhofer2024.absmag-and-ci', params: { av: '0.0000' }, evidence: [] });
    expect(summary(shipped(null)).map((r) => r.code)).toEqual([
      'v.curated', 'spectral.gspspec', 'ci.refused.uncalibrated', 'ci.printed-hip-bv',
    ]);
  });

  it('writes the outcome codes of a record nothing classifies or colours', () => {
    expect(summary({
      kind: 'shipped', key: KEY,
      v: { via: 'gliese', value: 11, evidence: [], refusals: [] },
      spectral: {
        via: 'none',
        refusals: [{ tier: 'gspspec', reason: 'unclassifiable', ref: APSIS_REF }],
      },
      ci: {
        via: 'none',
        refusals: [{ tier: 'spectral_derived', reason: 'apsis_teff_renders', ref: APSIS_REF }],
      },
      dust: null,
    })).toEqual([
      { role: 'outcome', code: 'v.gliese', params: {}, evidence: [] },
      { role: 'refused', code: 'spectral.refused.unclassifiable', params: { tier: 'gspspec' }, evidence: [sourceRowRefText(APSIS_REF)] },
      { role: 'outcome', code: 'spectral.none', params: {}, evidence: [] },
      {
        role: 'refused', code: 'ci.refused.apsis-teff-renders', params: { tier: 'spectral_derived' },
        evidence: [sourceRowRefText(APSIS_REF)],
      },
      { role: 'outcome', code: 'ci.none', params: {}, evidence: [] },
    ]);
  });

  it('encodes its rows as stage lines that decode back', () => {
    const b: BrightnessColour = { kind: 'v-only', key: 'spine:9', v: { via: 'tycho2', value: 9, evidence: [], refusals: [] } };
    const [line] = brightnessColourLineageLines(b);
    expect(decodeLineageLine(line)).toEqual(brightnessColourLineageRows(b)[0]);
    expect(decodeLineageLine(line).stage).toBe(BRIGHTNESS_COLOUR_CODES.stage);
  });

  it('pins A_V at four decimal places', () => {
    expect(AV_PARAM_DECIMALS).toBe(4);
  });
});
