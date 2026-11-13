// SID allocation as a lineage stage: its reason codes, live and historical, the one serialiser over its outcomes, and its key -> SID identity file. See README.md#sid-events.

import { sortUtf8, stageRow, type LineageParams, type LineageRow, type RowCoder } from '../catalog/lineage/lineage-row-pure';
import {
  HISTORICAL, admissionCode, outcomeCode, stageCodes, type StageCodes,
} from '../catalog/lineage/reason-codes/reason-codes-pure';
import { readTable, type TableSpec } from '../util/tsv/table-pure';
import type { Allocation, ObjectOutcome, SidObject } from './allocate-pure';
import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';
import { ALLOCATION_LINEAGE } from '../../src/catalog-format/pipeline-outputs/lineage-files';

export const ALLOCATION_LINEAGE_BUDGET = { gzipBytes: 19_300_000, writeMs: 28_000 };

const OBJECT_OUTCOMES = {
  resolved: outcomeCode('The object\'s same-as class reaches one SID in service, which it keeps.'),
  minted: outcomeCode('The object\'s same-as class reaches no ledger row, so it takes the next SID under its canonical key.'),
  reinstated: outcomeCode('The object\'s same-as class reaches only one retired SID, which returns to service.'),
};

type ObjectBranch = keyof typeof OBJECT_OUTCOMES;
export type ObjectOutcomeCodes = StageCodes<ObjectBranch>;


/** A stage that allocates objects and settles no orphan: its object outcomes' codes. */
export function objectOutcomeCodes(stage: string): ObjectOutcomeCodes {
  return stageCodes(stage, OBJECT_OUTCOMES);
}

export const ALLOCATION_CODES = stageCodes(ALLOCATION_LINEAGE.stage, {
  ...OBJECT_OUTCOMES,
  merged: outcomeCode('A SID no object keeps any more merges into the SID of the record its upstream decision names.', 'merge'),
  'merged.same-class': outcomeCode('One record now carries the keys of two SIDs in service and no stage decided the merge, so the same-as class is the decision: the SID that loses the canonical-key ladder merges into the one that wins.', 'merge'),
  retired: outcomeCode('A SID no object keeps any more leaves service under its upstream decision\'s code.', 'retire'),
  parked: outcomeCode('A SID no object keeps any more stays in service, absent from this build, under its upstream decision\'s code.', 'park'),
  'mint.sol-list': admissionCode('The object is a row of data/sid/sol-objects.tsv.'),
  'mint.shell-list': admissionCode('The object is a row of data/sid/shell-objects.tsv.'),
  'mint.cloud': admissionCode(`The object is a cloud ${PUBLIC_FILES.clouds} carries.`),
  'mint.local-group': admissionCode(`The object is a galaxy ${PUBLIC_FILES.localGroup} carries.`),
  'legacy.optical-cpm-test': outcomeCode('optical companion rejected by the Stage 5 WDS epoch-baseline CPM test (background star, not a physical companion)', 'retire', HISTORICAL),
  'legacy.component-dissolved': outcomeCode('A component the July 2026 re-pulls and promotion gates stopped emitting or promoting (re-paired, subsumed into an unpromoted aggregate, or its system no longer emitted), leaving no successor key.', 'retire', HISTORICAL),
  'legacy.component-parked': outcomeCode('A component whose record left the build while SIMBAD xids still name its own Gaia source: a presence gap filed as a retirement.', 'retire', HISTORICAL),
  'legacy.escape-velocity-optical': outcomeCode('A pair the Stage 5 escape-velocity gate reclassified optical once MSC per-component types replaced the default masses.', 'retire', HISTORICAL),
  'legacy.beyond-tidal-limit': outcomeCode('A component whose projected separation exceeds the 1 pc tidal limit once system distance coherence re-anchored its cluster: a line-of-sight member, not a bound companion.', 'retire', HISTORICAL),
  'legacy.claims-gate-pair-reclassified': outcomeCode('dissolved: component no longer emitted after the Stage-2 sibling-identity claims gate + system-PM CPM verdicts re-classified its pair', 'retire', HISTORICAL),
  'legacy.claims-gate-no-brightness': outcomeCode('dissolved: inner-pair member\'s inherited photometry came from a sibling-claimed identity; the Stage-2 sibling-identity claims gate unbound it and the record has no honest brightness source', 'retire', HISTORICAL),
  'legacy.claims-gate-no-position': outcomeCode('dissolved: the Stage-2 sibling-identity claims gate stripped the letter\'s stolen identity and no honest position source remains (no own astrometry, no anchor-offset chain)', 'retire', HISTORICAL),
  'legacy.anchor-parked-no-parallax': outcomeCode('A component that stops promoting because its anchor primary reaches no owned parallax and parks out of the catalogue: a presence event, filed as a retirement.', 'retire', HISTORICAL),
  'legacy.anchor-parked-refused-parallax': outcomeCode('A component that stops promoting because its anchor primary now reaches a SIMBAD parallax the cascade refuses as indefensible and parks: a presence event, filed as a retirement.', 'retire', HISTORICAL),
  'legacy.magnitude-floor-no-identifier': outcomeCode('A component that stops promoting at the V <= 11 magnitude floor: its pair row carries no identifier of its own and the build mints no record for it.', 'retire', HISTORICAL),
  'legacy.anchor-offset-unreached': outcomeCode('companion no longer promoted: Stage 6 now anchors its WDS root on Aa (the anchor promotion resolves), no measured edge reaches it from Aa, so its anchor offset is blank and promotion drops it; reinstate when the Aa-to-A offset link restores it', 'retire', HISTORICAL),
  'legacy.sibling-letter-twin': outcomeCode('A Gaia-keyed twin of a HIP record, split off it by a sibling-letter crosswalk error in AT-HYG; the sibling-letter gate scrubbed the cell and the two rows are one star.', 'merge', HISTORICAL),
  'legacy.claims-gate-synth-twin': outcomeCode('merged: synth twin and its first-class record are one star — the Stage-2 sibling-identity claims gate freed the member\'s own id (bridge in sameas-overrides.tsv)', 'merge', HISTORICAL),
  'legacy.synth-duplicate-of-named-star': outcomeCode('A synthetic component a curated identification (ORB6 or a SIMBAD xid) names as a first-class catalogue star, bridged in sameas-overrides.tsv.', 'merge', HISTORICAL),
  'legacy.minted-twin-of-anchor': outcomeCode('A promoted companion minted as a second copy of its own anchor, because its pair row carries the anchor\'s identifiers on both ends.', 'merge', HISTORICAL),
  'legacy.derived-binding-twin': outcomeCode('A Gaia-keyed row AT-HYG carried beside the HIP record it belongs to, merged when the manifest began deriving its Gaia binding.', 'merge', HISTORICAL),
  'legacy.fold-twin': outcomeCode('A Gaia-keyed twin of a HIP record that held the very source the derivation would give that record, merged by a spine-corrections fold.', 'merge', HISTORICAL),
  'legacy.label-merge-twin': outcomeCode('An HD row the primaries admitted beside the HIP record it names, merged when the label merge keyed on the derived binding put its designation back on that record.', 'merge', HISTORICAL),
  'legacy.magnitude-floor-own-record': outcomeCode('A component that stops promoting at the V <= 11 magnitude floor because its own DR3 source is an ordinary record, which the pair row resolves onto.', 'merge', HISTORICAL),
  'legacy.addition-admitted-twice': outcomeCode('one star admitted twice: an I/239 HIP or CNS5 row with no HD link was a record of its own beside the Tycho-2 star SIMBAD holds under the same Gaia source; the additions group on the derived source, so the two are one record and the sid merges into the canonical-key sid; old refs follow the successor', 'merge', HISTORICAL),
  'legacy.promoted-companion-twin': outcomeCode('promoted-companion twin of a named record: the named record now binds the component’s own Gaia source, so the synthetic promotion is the same star and its sid merges into the named record’s; old refs follow the successor', 'merge', HISTORICAL),
  'legacy.unnamed-gaia-twin': outcomeCode('unnamed Gaia-only twin of a named record: the V <= 11 magnitude term re-admitted a source the named record failed to bind (an addition with no SIMBAD route, or a component the sibling gate refused on a shared HIP); the named record now binds that source, so the sid merges into the named record’s and old refs follow the successor', 'merge', HISTORICAL),
  'legacy.photocentre-link-twin': outcomeCode('A synthetic component minted off its own record because its anchor cursor fell back onto that record; the Aa-to-A photocentre link resolves it onto the record.', 'merge', HISTORICAL),
  'legacy.xid-loss-twin': outcomeCode('A synthetic component minted after its pair rows lost their SIMBAD id, while the same star had already shipped on its own Gaia source; a same-as edge joins them and the gaia_dr3 key outranks synth on the canonical-key ladder.', 'merge', HISTORICAL),
  'legacy.claims-gate-restored': outcomeCode('component promotes again: the Stage-2 sibling-identity claims gate + id-less pair-row-primary promotion restored the honest record the earlier gates had dropped', 'none', HISTORICAL),
  'legacy.escape-gate-orbital-pm': outcomeCode('A component that reappears once the Stage 5 escape-velocity gate budgets for the host primary\'s orbital proper motion.', 'none', HISTORICAL),
  'legacy.refused-parallax-by-measurement': outcomeCode('A component that promotes again once the refused-parallax refusal matches on the measurement rather than on the id.', 'none', HISTORICAL),
  'legacy.magnitude-term-anchor': outcomeCode('A component that promotes again at the V <= 11 magnitude floor because its pair anchor is a magnitude-term record.', 'none', HISTORICAL),
  'legacy.photocentre-link-restored': outcomeCode('A component that promotes again once Stage 6 links its Aa anchor to A at the Aa+Ab photocentre, so the A-branch offset reaches it.', 'none', HISTORICAL),
  'legacy.astrometry-request-restored': outcomeCode('A component that promotes again once its blend-mate\'s Gaia source is in the binaries astrometry request, so its pair emits on gaia_5p.', 'none', HISTORICAL),
});

export type AllocationCounts = Readonly<Record<(typeof ALLOCATION_CODES.live)[number], number>>;

type Branch = Parameters<typeof ALLOCATION_CODES.code>[0];

type ParamsOf<B extends Branch> =
  B extends 'resolved' ? { via?: string }
  : B extends 'minted' ? { canonical_key: string; route: string }
  : B extends 'reinstated' ? { route: string }
  : B extends 'merged' ? { sid: string; canonical_key: string; cause: string; successor: string }
  : B extends 'retired' | 'parked' ? { sid: string; canonical_key: string; cause: string }
  : never;

const lineageRow = <B extends Branch>(
  codes: RowCoder<B>, key: string, branch: B, params: ParamsOf<B>,
): LineageRow => stageRow(codes, key, branch, params as LineageParams, []);

/** One row per object, under its origin. An object's SID rides the stage's key -> SID or identity file, not its row; `via` appears only when the object reached its ledger key through a designation it does not carry itself. */
export function objectOutcomeRows(
  codes: RowCoder<ObjectBranch>, objects: readonly SidObject[], outcomes: readonly ObjectOutcome[],
): LineageRow[] {
  return objects.map((obj, i): LineageRow => {
    const key = obj.origin;
    const o = outcomes[i];
    switch (o.kind) {
      case 'resolved': return lineageRow(codes, key, 'resolved', obj.designations.includes(o.via) ? {} : { via: o.via });
      case 'minted': return lineageRow(codes, key, 'minted', { canonical_key: o.canonicalKey, route: o.code });
      case 'reinstated': return lineageRow(codes, key, 'reinstated', { route: o.code });
      default: {
        const unmapped: never = o;
        throw new Error(`allocation outcome with no row mapping: ${JSON.stringify(unmapped)}`);
      }
    }
  });
}

/** objectOutcomeRows, plus one row per SID that left the build, under the origin of the decision that settled it. */
export function allocationLineageRows(
  objects: readonly SidObject[], allocation: Extract<Allocation, { kind: 'allocated' }>,
): LineageRow[] {
  const rows = objectOutcomeRows(ALLOCATION_CODES, objects, allocation.outcomes);
  for (const r of allocation.removals) {
    const base = { sid: String(r.sid), canonical_key: r.canonicalKey, cause: r.decision.code };
    rows.push(r.kind === 'merged'
      ? lineageRow(ALLOCATION_CODES, r.decision.origin, 'merged', { ...base, successor: String(r.into) })
      : lineageRow(ALLOCATION_CODES, r.decision.origin, r.kind, base));
  }
  return rows;
}

export const ALLOCATION_SIDS_COLUMNS = ['key', 'sid'] as const;

export interface AllocationSidRow {
  readonly key: string;
  readonly sid: number;
}

export function allocationSidRows(
  objects: readonly SidObject[], outcomes: readonly ObjectOutcome[],
): AllocationSidRow[] {
  return objects.map((obj, i) => ({ key: obj.origin, sid: outcomes[i].sid }));
}

export function allocationSidsText(rows: readonly AllocationSidRow[]): string {
  const sorted = sortUtf8([...rows], (r) => r.key);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].key === sorted[i - 1].key) throw new Error(`allocation identity: two objects keyed ${sorted[i].key}`);
  }
  return `${[ALLOCATION_SIDS_COLUMNS.join('\t'), ...sorted.map((r) => `${r.key}\t${r.sid}`)].join('\n')}\n`;
}

function sidsSpec(file: string): TableSpec<(typeof ALLOCATION_SIDS_COLUMNS)[number]> {
  return { file, columns: ALLOCATION_SIDS_COLUMNS, hint: 'Rebuild the catalogue.', exact: true };
}

export function* allocationSids(text: string, file: string): Generator<AllocationSidRow> {
  for (const row of readTable(sidsSpec(file), text)) yield { key: row.raw('key'), sid: row.requiredId('sid') };
}
