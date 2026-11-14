// Companion promotion as a lineage stage: its reason codes, the one serialiser over RowOutcome, its count summary, and the identity rows of the records it mints and the rows it removes. See README.md#promotion-lineage.

import { MULTIPLES_ROW_KEY } from '../../binaries/multiples-row-key-pure';
import { starDesignations } from '../../sid/sid-pure';
import { rowKeyText } from '../../util/sources/row-ref-pure';
import type { IdentityRow } from '../lineage/identity-pure';
import { evidenceTexts, stageRow, type LineageParams, type LineageRow } from '../lineage/lineage-row-pure';
import { codeEffects, outcomeCode, retired, stageCodes, type StageCounts } from '../lineage/reason-codes/reason-codes-pure';
import { formatPartition } from '../../util/counts/tally-pure';
import type { Star } from '../parse/stars-parse';
import { dustParams, EDENHOFER_AV } from '../photometry/brightness-colour-lineage-pure';
import { companionAbsmagIsObserved, companionCiIsObservedVia } from './companion-dust-pure';
import type {
  CompanionAbsmagSource, CompanionCiVia, MintedAdjustment, MintedBrightness, MultiplesTsvRow, PromotedRow,
  PromotionDerivedCounts, RowOutcome,
} from './companion-promotion';
import { PROMOTION_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const PROMOTION_LINEAGE_BUDGET = { gzipBytes: 1_400_000, writeMs: 10_000 };

const RETIRED_7_1_8 = retired('7.1.8');
const RETIRED_7_1_20 = retired('7.1.20');

const BRIGHTNESS_CODES = {
  dmag_imputed: 'dmag-imputed', own: 'own', wds_mag: 'wds-mag', spectral: 'spectral',
  inherited_twin: 'inherited-twin', anchor_collocated: 'anchor-collocated',
} as const satisfies Record<CompanionAbsmagSource, string>;

const COLOUR_CODES = {
  own: 'colour.own', spectral_derived: 'colour.spectral-derived', none: 'colour.none',
} as const satisfies Record<CompanionCiVia, string>;

const FACET_CODES = {
  'brightness.dmag-imputed': outcomeCode('The minted record\'s absolute magnitude is its anchor\'s absolute magnitude plus the pair\'s magnitude difference.'),
  'brightness.own': outcomeCode('The minted record\'s absolute magnitude is the row\'s own photometry.'),
  'brightness.wds-mag': outcomeCode('The minted record\'s absolute magnitude is the row\'s own WDS magnitude at the system\'s distance.'),
  'brightness.spectral': outcomeCode('The minted record\'s absolute magnitude is its per-component spectral type\'s absolute magnitude.'),
  'brightness.inherited-twin': outcomeCode('The minted record\'s absolute magnitude is the primary\'s inherited magnitude, kept because the pair has a renderable orbit.'),
  'brightness.anchor-collocated': outcomeCode('The minted record\'s absolute magnitude is its anchor\'s magnitude, the last resort for a pair\'s primary promoted as the anchor\'s companion.'),
  'brightness.blend-split': outcomeCode('The minted record shares its Gaia source with n records in all, whose light it is the blend of, so its absolute magnitude is dimmed by 2.5·log₁₀(n), an equal split.'),
  'brightness.anchor-re-split': outcomeCode('The anchor its magnitude difference is read off was dimmed to remove its members\' light, so the minted record\'s absolute magnitude is re-split from the anchor\'s new one.'),
  'colour.own': outcomeCode('The minted record\'s B−V is the row\'s own observed colour.'),
  'colour.spectral-derived': outcomeCode('The minted record\'s B−V is the intrinsic colour of its spectral class (Ballesteros 2012, /data/papers/index.md#ballesteros2012), the row carrying no colour of its own.'),
  'colour.none': outcomeCode('The minted record has no colour of its own and no derivable spectral class, so it bakes the solar B−V.'),
  'dust.edenhofer2024.absmag-and-ci': outcomeCode(`${EDENHOFER_AV} at the minted position is subtracted from absmag, and A_V/R_V from the observed B−V.`),
  'dust.edenhofer2024.absmag-only': outcomeCode(`${EDENHOFER_AV} at the minted position is subtracted from absmag; the B−V is intrinsic, so it is left as it is.`),
  'dust.edenhofer2024.ci-only': outcomeCode(`${EDENHOFER_AV} at the minted position, as A_V/R_V, is subtracted from the observed B−V; the absmag is its spectral class\'s, intrinsic, so it is left as it is.`),
  'dust.edenhofer2024.not-applied': outcomeCode(`${EDENHOFER_AV} at the minted position is subtracted from neither value: the absmag is its spectral class\'s and the B−V intrinsic.`),
  'spectral.ms-from-own-absmag': outcomeCode('The minted record\'s spectral class is a main-sequence estimate from its own absolute magnitude, the row\'s type being its primary\'s or blank.'),
  'constellation.split-from-anchor': outcomeCode('The minted record\'s position falls in another IAU constellation than its anchor\'s.'),
  'desig-con.from-anchor': outcomeCode('The adopted record carried no designation constellation and takes its anchor\'s.'),
  'fit.owned': outcomeCode('The refused row carries a per-component fit on an identifier of its own.'),
};
type Facet = keyof typeof FACET_CODES;

const brightnessFacet = (source: CompanionAbsmagSource): BareFacet => `brightness.${BRIGHTNESS_CODES[source]}`;

function dustFacet(b: MintedBrightness): Extract<Facet, `dust.${string}`> {
  const absmag = companionAbsmagIsObserved(b.source);
  const ci = companionCiIsObservedVia(b.ci);
  if (absmag) return ci ? 'dust.edenhofer2024.absmag-and-ci' : 'dust.edenhofer2024.absmag-only';
  return ci ? 'dust.edenhofer2024.ci-only' : 'dust.edenhofer2024.not-applied';
}

export const PROMOTION_CODES = stageCodes(PROMOTION_LINEAGE.stage, {
  'dropped.compound-comp': outcomeCode('The row\'s component letter is an unresolved aggregate of components that have rows of their own, so it is not one star.', 'retire'),
  'dropped.beyond-tidal-limit': outcomeCode('Projected at the anchor\'s distance, the pair is wider than the 1 pc tidal limit, so it cannot be bound.', 'retire'),
  'dropped.collocated-primary': outcomeCode('A pair\'s primary promoted as the system anchor\'s companion has neither its own fit nor a measured offset from the anchor, so it has no position.', 'retire'),
  'dropped.no-identifier': outcomeCode('The row has no Gaia source, no HIP of its own and no composable synthetic key.', 'retire', RETIRED_7_1_20),
  'dropped.anchor-is-component': outcomeCode('The row\'s ids resolve to its anchor\'s record, which the naming authority already letters as this component, so that record is the component.', 'merge'),
  'dropped.parked-record': outcomeCode('The distance the row states is a parallax a tier above refused, so promoting it would ship the parked record.', 'park', RETIRED_7_1_20),
  'dropped.parked-record.gaia-5p': outcomeCode('The distance the row states is a parallax a tier above refused, so promoting it would ship the parked record; the row\'s astrometry route is gaia_5p.', 'park'),
  'dropped.parked-record.other-route': outcomeCode('The distance the row states is a parallax a tier above refused, so promoting it would ship the parked record; the row\'s astrometry route is not gaia_5p.', 'park'),
  'dropped.no-position': outcomeCode('The row has neither an independent fit nor a measured separation and position angle off its anchor.', 'retire'),
  'dropped.no-absmag': outcomeCode('The row has no brightness of its own: no photometry, magnitude difference, WDS magnitude or per-component spectral type, and no renderable orbit.', 'retire'),
  'adopted.own-id': outcomeCode('The row\'s own Gaia source or HIP names a record already in the catalogue, which is the component.', 'merge'),
  'adopted.own-hip': outcomeCode('The row\'s Gaia source names no record, but its own HIP names one other than the anchor, which is the component.', 'merge'),
  'adopted.sameas-bridge': outcomeCode('A same-as edge bridges the row\'s synthetic key to a Gaia source already in the catalogue, whose record is the component.', 'merge'),
  'adopted.earlier-mint': outcomeCode('An earlier row of this build already minted the record this row names.', 'merge'),
  minted: outcomeCode('The row becomes a new catalogue record.', 'none', RETIRED_7_1_20),
  'minted.keyed': outcomeCode('The row becomes a new catalogue record, keyed on a Gaia source or HIP of its own.'),
  'minted.synthetic': outcomeCode('The row becomes a new catalogue record, addressed only by its synthetic key.'),
  repositioned: outcomeCode('An AT-HYG record sitting on the anchor under the anchor\'s name plus this letter is the component, and moves to the row\'s position.', 'merge', RETIRED_7_1_20),
  'primary-unresolved': outcomeCode(
    'A pair\'s primary resolves to no catalogue record and no escape places it, so its pair runs with no anchor.',
    'none', RETIRED_7_1_8,
  ),
  'not-applicable': outcomeCode(
    'Promotion decides nothing for the row: a pair\'s primary that anchors it, or a row in no pair.',
    'none', RETIRED_7_1_8,
  ),
  'parked.primary-unresolved': outcomeCode('A pair\'s primary resolves to no catalogue record and no escape places it, so it ships no record of its own and its pair runs with no anchor.', 'park'),
  'parked.unpaired': outcomeCode('The row is in no pair, so promotion has no geometry to place it with and ships no record for it.', 'park'),
  'not-applicable.pair-anchor': outcomeCode('Promotion decides nothing for the row: it is a pair\'s primary that anchors the pair.'),
  ...FACET_CODES,
});

type Branch = Parameters<typeof PROMOTION_CODES.code>[0];
type LiveBranch = Parameters<typeof PROMOTION_CODES.liveCode>[0];

const PROMOTION_EFFECTS = codeEffects([PROMOTION_CODES]);

const MINT_BRANCHES = { keyed: 'minted.keyed', synthetic: 'minted.synthetic' } as const satisfies Record<string, LiveBranch>;

export const PROMOTION_ADMISSION_CODES: ReadonlySet<string> = new Set(
  Object.values(MINT_BRANCHES).map((b) => PROMOTION_CODES.liveCode(b)),
);

type Via = { via: PromotedRow['via'] };

/** Each code's params, declared once beside the codes. */
type ParamsOf<B extends Branch> =
  B extends 'dropped.anchor-is-component' | 'adopted.earlier-mint' ? Via & { record: string }
  : B extends `adopted.${string}` ? Via & { record: string; recurated?: string }
  : Via;

type FacetParamsOf<F extends Facet> =
  F extends `dust.${string}` ? { av: string }
  : F extends 'brightness.blend-split' ? { n: string }
  : F extends 'brightness.anchor-re-split' ? { record: string }
  : Record<string, never>;

type FacetEntry = readonly [Facet, LineageParams];
type BareFacet = { [F in Facet]: FacetParamsOf<F> extends Record<string, never> ? F : never }[Facet];

const facet = <F extends Facet>(f: F, params: FacetParamsOf<F>): FacetEntry => [f, params];
const flag = (on: boolean, f: BareFacet): FacetEntry | false => on && [f, {}];

export function promotionOriginKey(row: Pick<MultiplesTsvRow, 'systemId' | 'comp'>): string {
  return rowKeyText(MULTIPLES_ROW_KEY, row);
}

export interface PromotionDecision {
  readonly outcome: LineageRow;
  readonly facets: readonly LineageRow[];
}

function adjustmentFacet(a: MintedAdjustment, recordKey: (idx: number) => string): FacetEntry {
  switch (a.pass) {
    case 'blend-split': return facet('brightness.blend-split', { n: String(a.n) });
    case 'anchor-re-split': return facet('brightness.anchor-re-split', { record: recordKey(a.anchorIdx) });
    default: {
      const unmapped: never = a;
      throw new Error(`minted adjustment with no row mapping: ${JSON.stringify(unmapped)}`);
    }
  }
}

/** `recordKey` is the origin key of the record at a pre-sort catalogue index. */
export function promotionDecision(r: PromotedRow, recordKey: (idx: number) => string): PromotionDecision {
  const key = promotionOriginKey(r.row);
  const o: RowOutcome = r.outcome;
  const cited = o.kind === 'dropped' && o.reason === 'parked-record' ? o.parked : null;
  const evidence = evidenceTexts(key, [r.anchor, r.systemAnchor, cited].filter((k): k is string => k !== null));
  const via = r.via;
  const row = <B extends Exclude<Branch, Facet>>(branch: B, params: ParamsOf<B>): LineageRow => (
    stageRow(PROMOTION_CODES, key, branch, params as LineageParams, evidence)
  );
  const decided = (outcome: LineageRow, facets: readonly (FacetEntry | false)[] = []): PromotionDecision => ({
    outcome,
    facets: facets.flatMap((f) => (f === false ? [] : [stageRow(PROMOTION_CODES, key, f[0], f[1], [])])),
  });
  switch (o.kind) {
    case 'dropped':
      if (o.reason === 'parked-record') {
        return decided(
          row(o.viaGaia5p ? 'dropped.parked-record.gaia-5p' : 'dropped.parked-record.other-route', { via }),
          [flag(o.ownedFit, 'fit.owned')],
        );
      }
      if (o.reason === 'anchor-is-component') {
        return decided(row('dropped.anchor-is-component', { via, record: recordKey(o.idx) }));
      }
      return decided(row(`dropped.${o.reason}`, { via }));
    case 'adopted':
      if (o.via === 'earlier-mint') return decided(row('adopted.earlier-mint', { via, record: recordKey(o.idx) }));
      return decided(
        row(`adopted.${o.via}`, {
          via, record: recordKey(o.idx), ...(o.recurated === null ? {} : { recurated: o.recurated }),
        }),
        [flag(o.desigConFromAnchor, 'desig-con.from-anchor')],
      );
    case 'minted':
      return decided(row(MINT_BRANCHES[o.synthetic ? 'synthetic' : 'keyed'], { via }), [
        facet(brightnessFacet(o.brightness.source), {}),
        o.brightness.adjustment !== null && adjustmentFacet(o.brightness.adjustment, recordKey),
        flag(o.brightness.spectMsFromOwnAbsmag, 'spectral.ms-from-own-absmag'),
        facet(COLOUR_CODES[o.brightness.ci], {}),
        facet(dustFacet(o.brightness), dustParams(o.brightness.av)),
        flag(o.constellationSplit, 'constellation.split-from-anchor'),
      ]);
    case 'primary-unresolved':
      return decided(row('parked.primary-unresolved', { via }));
    case 'unpaired':
      return decided(row('parked.unpaired', { via }));
    case 'pair-anchor':
      return decided(row('not-applicable.pair-anchor', { via }));
    default: {
      const unmapped: never = o;
      throw new Error(`promotion outcome with no row mapping: ${JSON.stringify(unmapped)}`);
    }
  }
}

export function decisionRows(d: PromotionDecision): LineageRow[] {
  return [d.outcome, ...d.facets];
}

/** Promotion's lines folded per live code. */
export type PromotionCounts = StageCounts<typeof PROMOTION_CODES>;

export const familyTotal = (counts: PromotionCounts, family: string): number => {
  const prefix = `${PROMOTION_CODES.stage}.${family}.`;
  return PROMOTION_CODES.live.reduce((n, code) => (code.startsWith(prefix) ? n + counts[code] : n), 0);
};

export function promotionSummary(counts: PromotionCounts, derived: PromotionDerivedCounts, pairRows: number): string {
  const c = (branch: LiveBranch): number => counts[PROMOTION_CODES.liveCode(branch)];
  return `  scanned ${pairRows} pair rows; promoted ${familyTotal(counts, 'minted')} `
    + `(${c('minted.synthetic')} via synthetic ID); `
    + `already-in-catalog ${familyTotal(counts, 'adopted')} `
    + `(re-curated ${formatPartition(derived.companionExistingMemberRecurated)}, `
    + `${c('adopted.sameas-bridge')} via same-as bridge); `
    + `dropped (no-position=${c('dropped.no-position')}, beyond-tidal=${c('dropped.beyond-tidal-limit')}, `
    + `no-absmag=${c('dropped.no-absmag')}, compound-comp=${c('dropped.compound-comp')}, `
    + `collocated-primary=${c('dropped.collocated-primary')}, anchor-is-component=${c('dropped.anchor-is-component')}); `
    + `absmag spectral-derived=${c('brightness.spectral')}, spect ms-from-own-absmag=${c('spectral.ms-from-own-absmag')}, `
    + `wds-mag-derived=${c('brightness.wds-mag')}, inherited-twin-orbital=${c('brightness.inherited-twin')}, `
    + `blend-split=${c('brightness.blend-split')}, `
    + `dimmed-anchors=${derived.companionBlendDimmedAnchors} (skipped ${derived.companionBlendDimSkipped}, `
    + `unfit ${derived.companionBlendDimUnfit}, outside ${derived.companionBlendDimOutside}, `
    + `gaia-resolved ${derived.companionBlendDimGaiaResolved}, `
    + `beyond-separation ${derived.companionBlendDimBeyondSeparation}, misfit ${derived.companionBlendDimMisfit}), `
    + `constellation-split-from-anchor=${c('constellation.split-from-anchor')}, `
    + `refused-parked=${familyTotal(counts, 'dropped.parked-record')} `
    + `(via gaia_5p ${c('dropped.parked-record.gaia-5p')}, owned fit ${c('fit.owned')})`;
}

export interface PromotionLineage {
  readonly lineage: LineageRow[];
  readonly identity: IdentityRow[];
}

/** Each row's lineage row; and one identity row per record promotion mints, and one per row it removes or merges (a retire, park or merge outcome) keyed on the HIP and Gaia cells it arrived with and the synthetic key a mint from it would carry, less any designation `founded` (membership's records) or a mint of this stage already carries. */
export function promotionLineage(
  rows: readonly PromotedRow[], stars: readonly Star[], founded: ReadonlySet<string>,
): PromotionLineage {
  const recordKey = (idx: number): string => stars[idx].originKey;
  const decided = rows.map((r) => promotionDecision(r, recordKey));
  const lineage = decided.flatMap(decisionRows);
  const minted = rows.flatMap(({ outcome: o }) => (o.kind === 'minted' ? [stars[o.idx]] : []))
    .map((s) => identityRow(s.originKey, s.hip, s.gaiaSourceId, starDesignations({ ...s, isSol: false })));
  const claimed = new Set([...founded, ...minted.flatMap((m) => m.designations)]);
  const removed = rows.flatMap((r, i): IdentityRow[] => {
    const effect = PROMOTION_EFFECTS.get(decided[i].outcome.code);
    if (effect === undefined || effect === 'none') return [];
    const designations = starDesignations({
      isSol: false, hip: r.row.hip, hd: null, hdAlt: [], hr: null, hrAlt: [], gl: null, syntheticId: r.synthKey,
      gaiaSourceId: r.row.gaiaSourceId,
    }).filter((d) => !claimed.has(d));
    if (designations.length === 0) return [];
    const kept = <T>(value: T | null, ns: string): T | null => (
      value !== null && designations.includes(`${ns}:${value}`) ? value : null
    );
    return [identityRow(
      promotionOriginKey(r.row), kept(r.row.hip, 'hip'), kept(r.row.gaiaSourceId, 'gaia_dr3'), designations,
    )];
  });
  return { lineage, identity: [...minted, ...removed] };
}

function identityRow(
  key: string, hip: number | null, gaiaSourceId: string | null, designations: string[],
): IdentityRow {
  return {
    key, tyc: '', hip: hip === null ? '' : String(hip), hd: '', gl: '', gaia_source_id: gaiaSourceId ?? '', designations,
  };
}
