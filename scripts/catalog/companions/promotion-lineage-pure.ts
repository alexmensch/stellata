// Companion promotion as a lineage stage: its reason codes, the one serialiser over RowOutcome, and the identity rows of the records it mints. See ../lineage/README.md#the-promotion-stage.

import { MULTIPLES_TSV } from '../../binaries/multiples-tsv';
import { starDesignations } from '../../sid/sid-pure';
import { sourceRowRef, sourceRowRefText } from '../../util/sources/row-ref-pure';
import type { IdentityRow } from '../lineage/identity-pure';
import { paramsText, type LineageParams, type LineageRow } from '../lineage/lineage-row-pure';
import { LIVE, stageCodes, type CodeDeclaration } from '../lineage/reason-codes-pure';
import type { Star } from '../parse/stars-parse';
import type { MintedBrightness, MultiplesTsvRow, PromotedRow, RowOutcome } from './companion-promotion';

export const PROMOTION_STAGE = 'promotion';

export const PROMOTION_LINEAGE_BUDGET = { gzipBytes: 800_000, writeMs: 5_000 };

const live = (description: string, effect: CodeDeclaration['effect'] = 'none'): CodeDeclaration => (
  { description, effect, status: LIVE }
);

export const PROMOTION_CODES = stageCodes(PROMOTION_STAGE, {
  'dropped.compound-comp': live('The row\'s component letter is an unresolved aggregate of components that have rows of their own, so it is not one star.', 'retire'),
  'dropped.beyond-tidal-limit': live('Projected at the anchor\'s distance, the pair is wider than the 1 pc tidal limit, so it cannot be bound.', 'retire'),
  'dropped.collocated-primary': live('A pair\'s primary promoted as the system anchor\'s companion has neither its own fit nor a measured offset from the anchor, so it has no position.', 'retire'),
  'dropped.no-identifier': live('The row has no Gaia source, no HIP of its own and no composable synthetic key.', 'retire'),
  'dropped.anchor-is-component': live('The row\'s ids resolve to its anchor\'s record, which the naming authority already letters as this component, so that record is the component.', 'merge'),
  'dropped.parked-record': live('The distance the row states is a parallax a tier above refused, so promoting it would ship the parked record.', 'park'),
  'dropped.no-position': live('The row has neither an independent fit nor a measured separation and position angle off its anchor.', 'retire'),
  'dropped.no-absmag': live('The row has no brightness of its own: no photometry, magnitude difference, WDS magnitude or per-component spectral type, and no renderable orbit.', 'retire'),
  'adopted.own-id': live('The row\'s own Gaia source or HIP names a record already in the catalogue, which is the component.', 'merge'),
  'adopted.own-hip': live('The row\'s Gaia source names no record, but its own HIP names one other than the anchor, which is the component.', 'merge'),
  'adopted.sameas-bridge': live('A same-as edge bridges the row\'s synthetic key to a Gaia source already in the catalogue, whose record is the component.', 'merge'),
  'adopted.earlier-mint': live('An earlier row of this build already minted the record this row names.', 'merge'),
  minted: live('The row becomes a new catalogue record.'),
  repositioned: live('An AT-HYG record sitting on the anchor under the anchor\'s name plus this letter is the component, and moves to the row\'s position.', 'merge'),
  'primary-unresolved': live('A pair\'s primary resolves to no catalogue record and no escape places it, so its pair runs with no anchor.'),
  'not-applicable': live('Promotion decides nothing for the row: a pair\'s primary that anchors it, or a row in no pair.'),
});

type Branch = Parameters<typeof PROMOTION_CODES.code>[0];

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
  return sourceRowRefText(sourceRowRef(MULTIPLES_TSV, row));
}

/** `recordKey` is the origin key of the record at a pre-sort catalogue index. */
export function promotionLineageRow(r: PromotedRow, recordKey: (idx: number) => string): LineageRow {
  const key = promotionOriginKey(r.row);
  const o: RowOutcome = r.outcome;
  const cited = o.kind === 'dropped' && o.reason === 'parked-record' ? o.parked : null;
  const evidence = [...new Set([r.anchor, r.systemAnchor, cited])]
    .filter((k): k is string => k !== null && k !== key);
  const via = r.via;
  const row = <B extends Branch>(branch: B, params: ParamsOf<B>): LineageRow => ({
    stage: PROMOTION_STAGE, key, role: 'outcome', code: PROMOTION_CODES.code(branch),
    params: paramsText(params as LineageParams), evidence,
  });
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
        ...(o.recuration === null ? {} : { recurated: o.recuration.brightness }),
      });
    case 'minted':
      return row('minted', {
        via, ...brightness(o.brightness), synthetic: flag(o.synthetic), constellation_split: flag(o.constellationSplit),
      });
    case 'repositioned':
      return row('repositioned', { via, ...brightness(o.brightness), record: recordKey(o.idx) });
    case 'primary-unresolved':
      return row('primary-unresolved', { via });
    case 'not-applicable':
      return row('not-applicable', { via });
    default: {
      const unmapped: never = o;
      throw new Error(`promotion outcome with no row mapping: ${JSON.stringify(unmapped)}`);
    }
  }
}

/** One identity row per record promotion mints; every other record's is membership's. */
export function promotionIdentityRows(rows: readonly PromotedRow[], stars: readonly Star[]): IdentityRow[] {
  return rows.flatMap(({ outcome: o }) => {
    if (o.kind !== 'minted') return [];
    const s = stars[o.idx];
    return [{
      key: s.originKey,
      tyc: '',
      hip: s.hip === null ? '' : String(s.hip),
      hd: '',
      gl: '',
      gaia_source_id: s.gaiaSourceId ?? '',
      designations: starDesignations({ ...s, isSol: false }),
    }];
  });
}
