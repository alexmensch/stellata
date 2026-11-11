// Companion promotion as a lineage stage: its reason codes, the one serialiser over RowOutcome, and the identity rows of the records it mints and the rows it removes. See ../lineage/README.md#the-promotion-stage.

import { MULTIPLES_ROW_KEY } from '../../binaries/multiples-row-key-pure';
import { starDesignations } from '../../sid/sid-pure';
import { rowKeyText } from '../../util/sources/row-ref-pure';
import type { IdentityRow } from '../lineage/identity-pure';
import { evidenceTexts, stageRow, type LineageParams, type LineageRow } from '../lineage/lineage-row-pure';
import { codeEffects, outcomeCode, stageCodes, retired } from '../lineage/reason-codes/reason-codes-pure';
import type { Star } from '../parse/stars-parse';
import type { MintedBrightness, MultiplesTsvRow, PromotedRow, RowOutcome } from './companion-promotion';
import { PROMOTION_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const PROMOTION_LINEAGE_BUDGET = { gzipBytes: 1_040_000, writeMs: 10_000 };

const RETIRED_7_1_8 = retired('7.1.8');

export const PROMOTION_CODES = stageCodes(PROMOTION_LINEAGE.stage, {
  'dropped.compound-comp': outcomeCode('The row\'s component letter is an unresolved aggregate of components that have rows of their own, so it is not one star.', 'retire'),
  'dropped.beyond-tidal-limit': outcomeCode('Projected at the anchor\'s distance, the pair is wider than the 1 pc tidal limit, so it cannot be bound.', 'retire'),
  'dropped.collocated-primary': outcomeCode('A pair\'s primary promoted as the system anchor\'s companion has neither its own fit nor a measured offset from the anchor, so it has no position.', 'retire'),
  'dropped.no-identifier': outcomeCode('The row has no Gaia source, no HIP of its own and no composable synthetic key.', 'retire'),
  'dropped.anchor-is-component': outcomeCode('The row\'s ids resolve to its anchor\'s record, which the naming authority already letters as this component, so that record is the component.', 'merge'),
  'dropped.parked-record': outcomeCode('The distance the row states is a parallax a tier above refused, so promoting it would ship the parked record.', 'park'),
  'dropped.no-position': outcomeCode('The row has neither an independent fit nor a measured separation and position angle off its anchor.', 'retire'),
  'dropped.no-absmag': outcomeCode('The row has no brightness of its own: no photometry, magnitude difference, WDS magnitude or per-component spectral type, and no renderable orbit.', 'retire'),
  'adopted.own-id': outcomeCode('The row\'s own Gaia source or HIP names a record already in the catalogue, which is the component.', 'merge'),
  'adopted.own-hip': outcomeCode('The row\'s Gaia source names no record, but its own HIP names one other than the anchor, which is the component.', 'merge'),
  'adopted.sameas-bridge': outcomeCode('A same-as edge bridges the row\'s synthetic key to a Gaia source already in the catalogue, whose record is the component.', 'merge'),
  'adopted.earlier-mint': outcomeCode('An earlier row of this build already minted the record this row names.', 'merge'),
  minted: outcomeCode('The row becomes a new catalogue record.'),
  repositioned: outcomeCode('An AT-HYG record sitting on the anchor under the anchor\'s name plus this letter is the component, and moves to the row\'s position.', 'merge'),
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
});

type Branch = Parameters<typeof PROMOTION_CODES.code>[0];

const PROMOTION_EFFECTS = codeEffects([PROMOTION_CODES]);

type Flag = 'true' | 'false';
type Via = { via: PromotedRow['via'] };
type Brightness = { absmag_source: MintedBrightness['source']; spect_ms_from_own_absmag: Flag };

/** Each code's params, declared once beside the codes. */
type ParamsOf<B extends Branch> =
  B extends 'dropped.parked-record' ? Via & { via_gaia_5p: Flag; owned_fit: Flag }
  : B extends 'dropped.anchor-is-component' ? Via & { record: string }
  : B extends 'adopted.earlier-mint' ? Via & { record: string }
  : B extends `adopted.${string}` ? Via & { record: string; desig_con_from_anchor: Flag; recurated?: string }
  : B extends 'minted' ? Via & Brightness & { synthetic: Flag; constellation_split: Flag }
  : B extends 'repositioned' ? Via & Brightness & { record: string }
  : Via;

const flag = (b: boolean): Flag => (b ? 'true' : 'false');

const brightness = (b: MintedBrightness): Brightness => (
  { absmag_source: b.source, spect_ms_from_own_absmag: flag(b.spectMsFromOwnAbsmag) }
);

export function promotionOriginKey(row: Pick<MultiplesTsvRow, 'systemId' | 'comp'>): string {
  return rowKeyText(MULTIPLES_ROW_KEY, row);
}

/** `recordKey` is the origin key of the record at a pre-sort catalogue index. */
export function promotionLineageRow(r: PromotedRow, recordKey: (idx: number) => string): LineageRow {
  const key = promotionOriginKey(r.row);
  const o: RowOutcome = r.outcome;
  const cited = o.kind === 'dropped' && o.reason === 'parked-record' ? o.parked : null;
  const evidence = evidenceTexts(key, [r.anchor, r.systemAnchor, cited].filter((k): k is string => k !== null));
  const via = r.via;
  const row = <B extends Branch>(branch: B, params: ParamsOf<B>): LineageRow => (
    stageRow(PROMOTION_CODES, key, branch, params as LineageParams, evidence)
  );
  switch (o.kind) {
    case 'dropped':
      if (o.reason === 'parked-record') {
        return row('dropped.parked-record', { via, via_gaia_5p: flag(o.viaGaia5p), owned_fit: flag(o.ownedFit) });
      }
      if (o.reason === 'anchor-is-component') {
        return row('dropped.anchor-is-component', { via, record: recordKey(o.idx) });
      }
      return row(`dropped.${o.reason}`, { via });
    case 'adopted':
      if (o.via === 'earlier-mint') return row('adopted.earlier-mint', { via, record: recordKey(o.idx) });
      return row(`adopted.${o.via}`, {
        via,
        record: recordKey(o.idx),
        desig_con_from_anchor: flag(o.desigConFromAnchor),
        ...(o.recurated === null ? {} : { recurated: o.recurated }),
      });
    case 'minted':
      return row('minted', {
        via, ...brightness(o.brightness), synthetic: flag(o.synthetic), constellation_split: flag(o.constellationSplit),
      });
    case 'repositioned':
      return row('repositioned', { via, ...brightness(o.brightness), record: recordKey(o.idx) });
    case 'primary-unresolved':
      return row('parked.primary-unresolved', { via });
    case 'unpaired':
      return row('parked.unpaired', { via });
    case 'pair-anchor':
      return row('not-applicable.pair-anchor', { via });
    default: {
      const unmapped: never = o;
      throw new Error(`promotion outcome with no row mapping: ${JSON.stringify(unmapped)}`);
    }
  }
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
  const lineage = rows.map((r) => promotionLineageRow(r, recordKey));
  const minted = rows.flatMap(({ outcome: o }) => (o.kind === 'minted' ? [stars[o.idx]] : []))
    .map((s) => identityRow(s.originKey, s.hip, s.gaiaSourceId, starDesignations({ ...s, isSol: false })));
  const claimed = new Set([...founded, ...minted.flatMap((m) => m.designations)]);
  const removed = rows.flatMap((r, i): IdentityRow[] => {
    const effect = PROMOTION_EFFECTS.get(lineage[i].code);
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
