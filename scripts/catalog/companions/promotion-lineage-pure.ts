// Companion promotion as a lineage stage: its reason codes, the one serialiser over RowOutcome, its count summary, and the identity rows of the records it mints and the rows it removes. See README.md#promotion-lineage.

import { MULTIPLES_ROW_KEY } from '../../binaries/multiples-row-key-pure';
import { starDesignations } from '../../sid/sid-pure';
import { rowKeyText } from '../../util/sources/row-ref-pure';
import type { IdentityRow } from '../lineage/identity-pure';
import { evidenceTexts, stageRow, type LineageParams, type LineageRow } from '../lineage/lineage-row-pure';
import {
  codeEffects, outcomeCode, retired, stageCodes, type CodeDeclaration, type LIVE,
} from '../lineage/reason-codes/reason-codes-pure';
import { formatPartition } from '../../util/counts/tally-pure';
import type { Star } from '../parse/stars-parse';
import type {
  CompanionAbsmagSource, MultiplesTsvRow, PromotedRow, PromotionDerivedCounts, RowOutcome,
} from './companion-promotion';
import { PROMOTION_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const PROMOTION_LINEAGE_BUDGET = { gzipBytes: 1_160_000, writeMs: 10_000 };

const RETIRED_7_1_8 = retired('7.1.8');
const RETIRED_7_1_20 = retired('7.1.20');

const BRIGHTNESS_CODES = {
  dmag_imputed: 'dmag-imputed', own: 'own', wds_mag: 'wds-mag', spectral: 'spectral',
  inherited_twin: 'inherited-twin', anchor_collocated: 'anchor-collocated',
} as const satisfies Record<CompanionAbsmagSource, string>;
type BrightnessCode = (typeof BRIGHTNESS_CODES)[CompanionAbsmagSource];

const BRIGHTNESS_SOURCES: Record<CompanionAbsmagSource, string> = {
  dmag_imputed: 'its anchor\'s absolute magnitude plus the pair\'s magnitude difference',
  own: 'the row\'s own photometry',
  wds_mag: 'the row\'s own WDS magnitude at the system\'s distance',
  spectral: 'its per-component spectral type\'s absolute magnitude',
  inherited_twin: 'the primary\'s inherited magnitude, kept because the pair has a renderable orbit',
  anchor_collocated: 'its anchor\'s magnitude, the last resort for a pair\'s primary promoted as the anchor\'s companion',
};

const brightnessCodes = Object.fromEntries((Object.keys(BRIGHTNESS_CODES) as CompanionAbsmagSource[]).map((source) => [
  `brightness.${BRIGHTNESS_CODES[source]}`,
  outcomeCode(`The minted record's absolute magnitude is ${BRIGHTNESS_SOURCES[source]}.`),
])) as Record<`brightness.${BrightnessCode}`, CodeDeclaration<typeof LIVE>>;

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
  ...brightnessCodes,
  'spectral.ms-from-own-absmag': outcomeCode('The minted record\'s spectral class is a main-sequence estimate from its own absolute magnitude, the row\'s type being its primary\'s or blank.'),
  'constellation.split-from-anchor': outcomeCode('The minted record\'s position falls in another IAU constellation than its anchor\'s.'),
  'desig-con.from-anchor': outcomeCode('The adopted record carried no designation constellation and takes its anchor\'s.'),
  'fit.owned': outcomeCode('The refused row carries a per-component fit on an identifier of its own.'),
});

type Branch = Parameters<typeof PROMOTION_CODES.code>[0];
type LiveBranch = Parameters<typeof PROMOTION_CODES.liveCode>[0];
type LiveCode = (typeof PROMOTION_CODES.live)[number];

const PROMOTION_EFFECTS = codeEffects([PROMOTION_CODES]);

type Via = { via: PromotedRow['via'] };
type Facet = `brightness.${BrightnessCode}` | 'spectral.ms-from-own-absmag' | 'constellation.split-from-anchor'
  | 'desig-con.from-anchor' | 'fit.owned';

/** Each code's params, declared once beside the codes. */
type ParamsOf<B extends Branch> =
  B extends 'dropped.anchor-is-component' | 'adopted.earlier-mint' ? Via & { record: string }
  : B extends `adopted.${string}` ? Via & { record: string; recurated?: string }
  : Via;

export function promotionOriginKey(row: Pick<MultiplesTsvRow, 'systemId' | 'comp'>): string {
  return rowKeyText(MULTIPLES_ROW_KEY, row);
}

/** The row's outcome row first, then one row per facet of its decision. `recordKey` is the origin key of the record at a pre-sort catalogue index. */
export function promotionLineageRows(r: PromotedRow, recordKey: (idx: number) => string): LineageRow[] {
  const key = promotionOriginKey(r.row);
  const o: RowOutcome = r.outcome;
  const cited = o.kind === 'dropped' && o.reason === 'parked-record' ? o.parked : null;
  const evidence = evidenceTexts(key, [r.anchor, r.systemAnchor, cited].filter((k): k is string => k !== null));
  const via = r.via;
  const row = <B extends Exclude<Branch, Facet>>(branch: B, params: ParamsOf<B>): LineageRow => (
    stageRow(PROMOTION_CODES, key, branch, params as LineageParams, evidence)
  );
  const facet = (branch: Facet): LineageRow => stageRow(PROMOTION_CODES, key, branch, {}, []);
  switch (o.kind) {
    case 'dropped':
      if (o.reason === 'parked-record') {
        return [
          row(o.viaGaia5p ? 'dropped.parked-record.gaia-5p' : 'dropped.parked-record.other-route', { via }),
          ...(o.ownedFit ? [facet('fit.owned')] : []),
        ];
      }
      if (o.reason === 'anchor-is-component') {
        return [row('dropped.anchor-is-component', { via, record: recordKey(o.idx) })];
      }
      return [row(`dropped.${o.reason}`, { via })];
    case 'adopted':
      if (o.via === 'earlier-mint') return [row('adopted.earlier-mint', { via, record: recordKey(o.idx) })];
      return [
        row(`adopted.${o.via}`, {
          via, record: recordKey(o.idx), ...(o.recurated === null ? {} : { recurated: o.recurated }),
        }),
        ...(o.desigConFromAnchor ? [facet('desig-con.from-anchor')] : []),
      ];
    case 'minted':
      return [
        row(o.synthetic ? 'minted.synthetic' : 'minted.keyed', { via }),
        facet(`brightness.${BRIGHTNESS_CODES[o.brightness.source]}`),
        ...(o.brightness.spectMsFromOwnAbsmag ? [facet('spectral.ms-from-own-absmag')] : []),
        ...(o.constellationSplit ? [facet('constellation.split-from-anchor')] : []),
      ];
    case 'primary-unresolved':
      return [row('parked.primary-unresolved', { via })];
    case 'unpaired':
      return [row('parked.unpaired', { via })];
    case 'pair-anchor':
      return [row('not-applicable.pair-anchor', { via })];
    default: {
      const unmapped: never = o;
      throw new Error(`promotion outcome with no row mapping: ${JSON.stringify(unmapped)}`);
    }
  }
}

/** Promotion's lines folded per live code. */
export type PromotionCounts = Readonly<Record<LiveCode, number>>;

const familyTotal = (counts: PromotionCounts, family: string): number => {
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
    + `blend-split=${derived.companionBlendSplit}, `
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
  const decided = rows.map((r) => promotionLineageRows(r, recordKey));
  const lineage = decided.flat();
  const minted = rows.flatMap(({ outcome: o }) => (o.kind === 'minted' ? [stars[o.idx]] : []))
    .map((s) => identityRow(s.originKey, s.hip, s.gaiaSourceId, starDesignations({ ...s, isSol: false })));
  const claimed = new Set([...founded, ...minted.flatMap((m) => m.designations)]);
  const removed = rows.flatMap((r, i): IdentityRow[] => {
    const effect = PROMOTION_EFFECTS.get(decided[i][0].code);
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
