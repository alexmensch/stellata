// Size as a lineage stage: its reason codes and the one serialiser over each walked record's radius route. See README.md#size-lineage.

import {
  evidenceTexts, paramsText, stageLineageLine, type LineageLine, type LineageParams, type LineageRole, type LineageRow,
} from '../lineage/lineage-row-pure';
import { outcomeCode, refusalCode, stageCodes } from '../lineage/reason-codes/reason-codes-pure';
import { sourceRowRefText, type AnySourceRowRef } from '../../util/sources/row-ref-pure';
import {
  APSIS_TEFF_MAX_K, APSIS_TEFF_MIN_K, NON_FINITE_LUMINOSITY_RADIUS_R_SUN,
  type ApsisSolution, type ClassIndex, type RadiusClamp, type RadiusResolution,
} from '../../../src/catalog-format/spectral/physical-radius';
import { SIZE_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const SIZE_LINEAGE_BUDGET = { gzipBytes: 26_700_000, writeMs: 30_000 };

/** Decimal places of `params.absmag`: 0.1 mmag, below every V tier's own error. */
export const ABSMAG_PARAM_DECIMALS = 4;

export const SIZE_CODES = stageCodes(SIZE_LINEAGE.stage, {
  'white-dwarf': outcomeCode('A white dwarf: the fixed typical white-dwarf radius, since absmag does not translate into one.'),
  'apsis-teff': outcomeCode('Stefan-Boltzmann from the record\'s de-extincted absmag and its own Gaia DR3 Apsis Teff, with the class-table bolometric correction.'),
  'class-teff': outcomeCode('Stefan-Boltzmann from the record\'s de-extincted absmag and the class-table Teff and bolometric correction.'),
  'non-finite-luminosity': outcomeCode(`The absmag gives a luminosity no float holds, so the record ships the ${NON_FINITE_LUMINOSITY_RADIUS_R_SUN} R☉ stand-in.`),
  'refused.apsis-teff-out-of-window': refusalCode(`An Apsis Teff solution lies outside the ${APSIS_TEFF_MIN_K / 1000}–${APSIS_TEFF_MAX_K / 1000} kK sanity window the radius chain accepts.`),
  'refused.apsis-teff-white-dwarf': refusalCode('The record\'s Apsis Teff stands down: a white dwarf takes the fixed radius, and Apsis does not model its atmosphere.'),
  'refused.apsis-teff-wolf-rayet': refusalCode('The record\'s Apsis Teff stands down: a Wolf-Rayet keeps its own Teff ramp, and Apsis does not model its atmosphere.'),
});

type Branch = Parameters<typeof SIZE_CODES.code>[0];

interface StefanBoltzmannParams {
  absmag: string;
  class_index: ClassIndex;
  clamp?: RadiusClamp;
}

type ParamsOf<B extends Branch> =
  B extends 'apsis-teff' ? StefanBoltzmannParams & { solution: ApsisSolution }
  : B extends 'class-teff' ? StefanBoltzmannParams
  : B extends 'non-finite-luminosity' ? { absmag: string }
  : B extends `refused.${string}` ? { solution: ApsisSolution }
  : Record<string, never>;

/** See README.md#size-lineage. */
export interface Size {
  readonly key: string;
  readonly radius: RadiusResolution;
  readonly apsis: { readonly ref: AnySourceRowRef; readonly outOfWindow: readonly ApsisSolution[] } | null;
  readonly classEvidence: readonly AnySourceRowRef[];
}

/** Every row one record's Size serialises to; the `switch` is exhaustive, so
 *  a new route without rows fails typecheck. */
export function sizeLineageRows({ key, radius, apsis, classEvidence }: Size): LineageRow[] {
  const out: LineageRow[] = [];
  const push = <B extends Branch>(role: LineageRole, branch: B, params: ParamsOf<B>, refs: readonly AnySourceRowRef[]): void => {
    out.push({
      stage: SIZE_LINEAGE.stage, key, role, code: SIZE_CODES.code(branch),
      params: paramsText(params as LineageParams),
      evidence: evidenceTexts(key, refs.map(sourceRowRefText)),
    });
  };
  const absmag = (value: number): string => value.toFixed(ABSMAG_PARAM_DECIMALS);
  const apsisRefs = apsis === null ? [] : [apsis.ref];
  for (const solution of apsis?.outOfWindow ?? []) {
    push('refused', 'refused.apsis-teff-out-of-window', { solution }, apsisRefs);
  }
  const clamp = (c: RadiusClamp | null) => (c === null ? {} : { clamp: c });

  switch (radius.route) {
    case 'white-dwarf':
      if (radius.refusedTeff !== null) {
        push('refused', 'refused.apsis-teff-white-dwarf', { solution: radius.refusedTeff.solution }, apsisRefs);
      }
      push('outcome', 'white-dwarf', {}, classEvidence);
      return out;
    case 'apsis-teff':
      push('outcome', 'apsis-teff', {
        absmag: absmag(radius.absmag), solution: radius.teff.solution, class_index: radius.classIndex, ...clamp(radius.clamp),
      }, [...apsisRefs, ...classEvidence]);
      return out;
    case 'class-teff':
      if (radius.refusedTeff !== null) {
        push('refused', 'refused.apsis-teff-wolf-rayet', { solution: radius.refusedTeff.solution }, apsisRefs);
      }
      push('outcome', 'class-teff', {
        absmag: absmag(radius.absmag), class_index: radius.classIndex, ...clamp(radius.clamp),
      }, classEvidence);
      return out;
    case 'non-finite-luminosity':
      push('outcome', 'non-finite-luminosity', { absmag: absmag(radius.absmag) }, classEvidence);
      return out;
    default: {
      const unmapped: never = radius;
      throw new Error(`size outcome with no row mapping: ${JSON.stringify(unmapped)}`);
    }
  }
}

/** A record's rows as lines, so the walk holds strings rather than its outcomes. */
export function sizeLineageLines(size: Size): LineageLine[] {
  return sizeLineageRows(size).map((row) => stageLineageLine(SIZE_CODES, row));
}
