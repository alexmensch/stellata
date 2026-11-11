// Brightness and colour as a lineage stage: its reason codes and the one serialiser over each walked record's V, spectral class, B−V and de-extinction. See README.md#brightness-colour-lineage.

import {
  evidenceTexts, stageLineageLine, type LineageLine, type LineageParams, type LineageRow, stageRow,
} from '../lineage/lineage-row-pure';
import { outcomeCode, refusalCode, stageCodes } from '../lineage/reason-codes/reason-codes-pure';
import { sourceRowRefText, type AnySourceRowRef } from '../../util/sources/row-ref-pure';
import type { CascadeRefusal } from '../cascade-result';
import type { ColourIndexResolution, CiVia } from './colour-index-pure';
import type { PhotometryRefusal } from './gaia-photometry-pure';
import type { VMagnitudeResolution, VVia } from './v-magnitude-pure';
import type { SpectralRefusal, SpectralResolution, SpectralVia } from '../spectral/spectral-resolve';
import { BRIGHTNESS_COLOUR_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const BRIGHTNESS_COLOUR_LINEAGE_BUDGET = { gzipBytes: 42_400_000, writeMs: 60_000 };

/** Decimal places of `params.av`: 0.1 mmag, far below any V tier's own error. */
export const AV_PARAM_DECIMALS = 4;

const V_BRANCHES = {
  gaia_riello: 'v.gaia-riello',
  printed_hip: 'v.printed-hip',
  tycho2: 'v.tycho2',
  gliese: 'v.gliese',
  curated: 'v.curated',
  none: 'v.none',
} as const satisfies Record<VVia, string>;

const PHOTOMETRY_REFUSAL_BRANCHES = {
  v: {
    uncalibrated: 'v.refused.uncalibrated',
    colour_out_of_range: 'v.refused.colour-out-of-range',
  },
  ci: {
    uncalibrated: 'ci.refused.uncalibrated',
    colour_out_of_range: 'ci.refused.colour-out-of-range',
  },
} as const satisfies Record<'v' | 'ci', Record<PhotometryRefusal, string>>;

const CI_BRANCHES = {
  gaia_relation: 'ci.gaia-relation',
  printed_hip_bv: 'ci.printed-hip-bv',
  gspc: 'ci.gspc',
  spectral_derived: 'ci.spectral-derived',
  none: 'ci.none',
} as const satisfies Record<CiVia, string>;

const CI_REFUSAL_BRANCHES = {
  ...PHOTOMETRY_REFUSAL_BRANCHES.ci,
  non_finite: 'ci.refused.non-finite',
  apsis_teff_renders: 'ci.refused.apsis-teff-renders',
} as const satisfies Record<ColourIndexResolution['refusals'][number]['reason'], string>;

const SPECTRAL_BRANCHES = {
  curated: 'spectral.curated',
  simbad: 'spectral.simbad',
  gspspec: 'spectral.gspspec',
  none: 'spectral.none',
} as const satisfies Record<SpectralVia, string>;

const SPECTRAL_REFUSAL_BRANCHES = {
  gaia_id_contradicts: 'spectral.refused.gaia-id-contradicts',
  unclassifiable: 'spectral.refused.unclassifiable',
} as const satisfies Record<SpectralRefusal['reason'], string>;

export const BRIGHTNESS_COLOUR_CODES = stageCodes(BRIGHTNESS_COLOUR_LINEAGE.stage, {
  'v.gaia-riello': outcomeCode('Johnson V transformed from the record\'s own Gaia DR3 photometry through the Riello 2021 (/data/papers/index.md#riello2021) relation.'),
  'v.printed-hip': outcomeCode('The printed Hipparcos V of the record\'s own HIP (I/239), where the Gaia relation does not apply.'),
  'v.tycho2': outcomeCode('Johnson V reduced from the record\'s own Tycho-2 BT and VT, where no tier above answers.'),
  'v.gliese': outcomeCode('The printed V/70A V of the record\'s own GJ, where no tier above answers.'),
  'v.curated': outcomeCode('Sol: the curated record\'s V.'),
  'v.none': outcomeCode('No V tier lights the record.'),
  'v.refused.uncalibrated': refusalCode('The record\'s Gaia photometry has a band missing or non-finite, or G is brighter than the saturation bound, so the Riello relation does not apply.'),
  'v.refused.colour-out-of-range': refusalCode('The record\'s Gaia BP−RP lies outside the range the Riello relation is published over.'),
  'ci.gaia-relation': outcomeCode('B−V as the difference of the Gaia DR3 Table 5.9 G−V and G−B relations on the record\'s own photometry.'),
  'ci.printed-hip-bv': outcomeCode('The printed Hipparcos B−V of the record\'s own HIP (I/239).'),
  'ci.gspc': outcomeCode('B−V from Gaia DR3 synthetic photometry of the record\'s own source, inside its measured colour bound.'),
  'ci.spectral-derived': outcomeCode('The intrinsic colour of the record\'s spectral class, for a record with no Apsis Teff.'),
  'ci.none': outcomeCode('No tier colours the record, so it bakes the solar B−V.'),
  'ci.refused.uncalibrated': refusalCode('The record\'s Gaia photometry has a band missing or non-finite, or G is brighter than the saturation bound, so a Gaia colour does not apply.'),
  'ci.refused.colour-out-of-range': refusalCode('The record\'s Gaia BP−RP lies outside the range the colour tier holds over.'),
  'ci.refused.non-finite': refusalCode('The printed Hipparcos B−V is not a finite number.'),
  'ci.refused.apsis-teff-renders': refusalCode('The spectral-class colour stands down: the shader colours the record from its Apsis Teff instead.'),
  'spectral.curated': outcomeCode('The curated MK type: the record\'s own (Sol) or the hand-curated override for its HIP.'),
  'spectral.simbad': outcomeCode('SIMBAD\'s MK sp_type, on the first namespace of the ladder that reaches a typed row for the record.'),
  'spectral.gspspec': outcomeCode('The Gaia DR3 ESP-ELS spectral letter for the record\'s own source, where no SIMBAD row classifies it.'),
  'spectral.none': outcomeCode('No tier classifies the record, so it renders as spectral type unknown.'),
  'spectral.refused.gaia-id-contradicts': refusalCode('A SIMBAD row states a Gaia DR3 id other than the record\'s own, so it describes another star.'),
  'spectral.refused.unclassifiable': refusalCode('A typed row\'s spectral string does not parse as a Morgan-Keenan class.'),
  'dust.edenhofer2024.absmag-and-ci': outcomeCode('The Sol-to-star A_V through the Edenhofer 2024 (/data/papers/index.md#edenhofer2024) dust grid is subtracted from absmag, and A_V/R_V from the observed B−V.'),
  'dust.edenhofer2024.absmag-only': outcomeCode('The Sol-to-star A_V through the Edenhofer 2024 (/data/papers/index.md#edenhofer2024) dust grid is subtracted from absmag; the B−V is intrinsic, so it is left as it is.'),
});

type Branch = Parameters<typeof BRIGHTNESS_COLOUR_CODES.code>[0];

type ParamsOf<B extends Branch> =
  B extends 'spectral.simbad' ? { namespace: string }
  : B extends `dust.${string}` ? { av: string }
  : Record<string, never>;

/** The Sol-to-star extinction a walked record was de-extincted by. */
export interface DustStep {
  readonly av: number;
  /** Whether the B−V was observed-convention, so de-reddened too. */
  readonly ciDereddened: boolean;
}

/** See README.md#brightness-colour-lineage. */
export type BrightnessColour =
  | {
    readonly kind: 'v-only';
    readonly key: string;
    readonly v: VMagnitudeResolution;
  }
  | {
    readonly kind: 'shipped';
    readonly key: string;
    readonly v: Exclude<VMagnitudeResolution, { via: 'none' }>;
    readonly spectral: SpectralResolution;
    readonly ci: ColourIndexResolution;
    /** Null where the walk ran without a dust grid, which only a test does. */
    readonly dust: DustStep | null;
  };

export type ShippedBrightness = Extract<BrightnessColour, { kind: 'shipped' }>;

/** Every row one record's BrightnessColour serialises to; the `switch` is
 *  exhaustive, so a new variant without rows fails typecheck. */
export function brightnessColourLineageRows(b: BrightnessColour): LineageRow[] {
  const { key } = b;
  const out: LineageRow[] = [];
  const push = (branch: Branch, params: LineageParams, refs: readonly AnySourceRowRef[]): void => {
    out.push(stageRow(BRIGHTNESS_COLOUR_CODES, key, branch, params, evidenceTexts(key, refs.map(sourceRowRefText))));
  };
  const row = <B extends Branch>(branch: B, params: ParamsOf<B>, refs: readonly AnySourceRowRef[]): void => {
    push(branch, params, refs);
  };
  const refused = <R extends CascadeRefusal<string, string> & Readonly<Record<Exclude<keyof R, 'ref'>, string>>>(
    refusals: readonly R[], branches: Readonly<Record<R['reason'], Branch>>,
  ): void => {
    for (const { reason, ref, ...params } of refusals) {
      push(branches[reason as R['reason']], params as unknown as LineageParams, [ref]);
    }
  };
  const none = {} as Record<string, never>;
  const answered = (
    res: { readonly via: 'none' } | { readonly evidence: readonly AnySourceRowRef[] },
  ): readonly AnySourceRowRef[] => ('evidence' in res ? res.evidence : []);

  const v = (res: VMagnitudeResolution): void => {
    refused(res.refusals, PHOTOMETRY_REFUSAL_BRANCHES.v);
    row(V_BRANCHES[res.via], none, answered(res));
  };

  switch (b.kind) {
    case 'v-only':
      v(b.v);
      return out;
    case 'shipped': {
      v(b.v);
      const { spectral, ci, dust } = b;
      refused(spectral.refusals, SPECTRAL_REFUSAL_BRANCHES);
      if (spectral.via === 'simbad') {
        row('spectral.simbad', { namespace: spectral.value.namespace }, spectral.evidence);
      } else {
        row(SPECTRAL_BRANCHES[spectral.via], none, answered(spectral));
      }
      refused(ci.refusals, CI_REFUSAL_BRANCHES);
      row(CI_BRANCHES[ci.via], none, answered(ci));
      if (dust !== null) {
        row(dust.ciDereddened ? 'dust.edenhofer2024.absmag-and-ci' : 'dust.edenhofer2024.absmag-only',
          { av: dust.av.toFixed(AV_PARAM_DECIMALS) }, []);
      }
      return out;
    }
    default: {
      const unmapped: never = b;
      throw new Error(`brightness-colour outcome with no row mapping: ${JSON.stringify(unmapped)}`);
    }
  }
}

/** A record's rows as lines, so the walk holds strings rather than its outcomes. */
export function brightnessColourLineageLines(b: BrightnessColour): LineageLine[] {
  return brightnessColourLineageRows(b).map((row) => stageLineageLine(BRIGHTNESS_COLOUR_CODES, row));
}
