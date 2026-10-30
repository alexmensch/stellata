// SID allocation as a lineage stage: its reason codes, live and historical. See ../catalog/lineage/README.md#sid-events.

import type { StageLineageSpec } from '../catalog/lineage/lineage-io';
import { stageCodes, type CodeDeclaration, type CodeEffect } from '../catalog/lineage/reason-codes-pure';

export const ALLOCATION_STAGE = 'allocation';

export const ALLOCATION_LINEAGE: StageLineageSpec<'allocation', 'allocation'> = {
  stage: ALLOCATION_STAGE,
  files: ['allocation'],
};

const historical = (effect: CodeEffect, description: string): CodeDeclaration => (
  { description, effect, status: { kind: 'historical' } }
);

export const ALLOCATION_CODES = stageCodes(ALLOCATION_STAGE, {
  'legacy.optical-cpm-test': historical('retire', 'optical companion rejected by the Stage 5 WDS epoch-baseline CPM test (background star, not a physical companion)'),
  'legacy.component-dissolved': historical('retire', 'A component the July 2026 re-pulls and promotion gates stopped emitting or promoting (re-paired, subsumed into an unpromoted aggregate, or its system no longer emitted), leaving no successor key.'),
  'legacy.component-parked': historical('retire', 'A component whose record left the build while SIMBAD xids still name its own Gaia source: a presence gap filed as a retirement.'),
  'legacy.escape-velocity-optical': historical('retire', 'A pair the Stage 5 escape-velocity gate reclassified optical once MSC per-component types replaced the default masses.'),
  'legacy.beyond-tidal-limit': historical('retire', 'A component whose projected separation exceeds the 1 pc tidal limit once system distance coherence re-anchored its cluster: a line-of-sight member, not a bound companion.'),
  'legacy.claims-gate-pair-reclassified': historical('retire', 'dissolved: component no longer emitted after the Stage-2 sibling-identity claims gate + system-PM CPM verdicts re-classified its pair'),
  'legacy.claims-gate-no-brightness': historical('retire', 'dissolved: inner-pair member\'s inherited photometry came from a sibling-claimed identity; the Stage-2 sibling-identity claims gate unbound it and the record has no honest brightness source'),
  'legacy.claims-gate-no-position': historical('retire', 'dissolved: the Stage-2 sibling-identity claims gate stripped the letter\'s stolen identity and no honest position source remains (no own astrometry, no anchor-offset chain)'),
  'legacy.anchor-parked-no-parallax': historical('retire', 'A component that stops promoting because its anchor primary reaches no owned parallax and parks out of the catalogue: a presence event, filed as a retirement.'),
  'legacy.anchor-parked-refused-parallax': historical('retire', 'A component that stops promoting because its anchor primary now reaches a SIMBAD parallax the cascade refuses as indefensible and parks: a presence event, filed as a retirement.'),
  'legacy.magnitude-floor-no-identifier': historical('retire', 'A component that stops promoting at the V <= 11 magnitude floor: its pair row carries no identifier of its own and the build mints no record for it.'),
  'legacy.anchor-offset-unreached': historical('retire', 'companion no longer promoted: Stage 6 now anchors its WDS root on Aa (the anchor promotion resolves), no measured edge reaches it from Aa, so its anchor offset is blank and promotion drops it; reinstate when the Aa-to-A offset link restores it'),
  'legacy.sibling-letter-twin': historical('merge', 'A Gaia-keyed twin of a HIP record, split off it by a sibling-letter crosswalk error in AT-HYG; the sibling-letter gate scrubbed the cell and the two rows are one star.'),
  'legacy.claims-gate-synth-twin': historical('merge', 'merged: synth twin and its first-class record are one star — the Stage-2 sibling-identity claims gate freed the member\'s own id (bridge in sameas-overrides.tsv)'),
  'legacy.synth-duplicate-of-named-star': historical('merge', 'A synthetic component a curated identification (ORB6 or a SIMBAD xid) names as a first-class catalogue star, bridged in sameas-overrides.tsv.'),
  'legacy.minted-twin-of-anchor': historical('merge', 'A promoted companion minted as a second copy of its own anchor, because its pair row carries the anchor\'s identifiers on both ends.'),
  'legacy.derived-binding-twin': historical('merge', 'A Gaia-keyed row AT-HYG carried beside the HIP record it belongs to, merged when the manifest began deriving its Gaia binding.'),
  'legacy.fold-twin': historical('merge', 'A Gaia-keyed twin of a HIP record that held the very source the derivation would give that record, merged by a spine-corrections fold.'),
  'legacy.label-merge-twin': historical('merge', 'An HD row the primaries admitted beside the HIP record it names, merged when the label merge keyed on the derived binding put its designation back on that record.'),
  'legacy.magnitude-floor-own-record': historical('merge', 'A component that stops promoting at the V <= 11 magnitude floor because its own DR3 source is an ordinary record, which the pair row resolves onto.'),
  'legacy.addition-admitted-twice': historical('merge', 'one star admitted twice: an I/239 HIP or CNS5 row with no HD link was a record of its own beside the Tycho-2 star SIMBAD holds under the same Gaia source; the additions group on the derived source, so the two are one record and the sid merges into the canonical-key sid; old refs follow the successor'),
  'legacy.promoted-companion-twin': historical('merge', 'promoted-companion twin of a named record: the named record now binds the component’s own Gaia source, so the synthetic promotion is the same star and its sid merges into the named record’s; old refs follow the successor'),
  'legacy.unnamed-gaia-twin': historical('merge', 'unnamed Gaia-only twin of a named record: the V <= 11 magnitude term re-admitted a source the named record failed to bind (an addition with no SIMBAD route, or a component the sibling gate refused on a shared HIP); the named record now binds that source, so the sid merges into the named record’s and old refs follow the successor'),
  'legacy.photocentre-link-twin': historical('merge', 'A synthetic component minted off its own record because its anchor cursor fell back onto that record; the Aa-to-A photocentre link resolves it onto the record.'),
  'legacy.claims-gate-restored': historical('none', 'component promotes again: the Stage-2 sibling-identity claims gate + id-less pair-row-primary promotion restored the honest record the earlier gates had dropped'),
  'legacy.escape-gate-orbital-pm': historical('none', 'A component that reappears once the Stage 5 escape-velocity gate budgets for the host primary\'s orbital proper motion.'),
  'legacy.refused-parallax-by-measurement': historical('none', 'A component that promotes again once the refused-parallax refusal matches on the measurement rather than on the id.'),
  'legacy.magnitude-term-anchor': historical('none', 'A component that promotes again at the V <= 11 magnitude floor because its pair anchor is a magnitude-term record.'),
  'legacy.photocentre-link-restored': historical('none', 'A component that promotes again once Stage 6 links its Aa anchor to A at the Aa+Ab photocentre, so the A-branch offset reaches it.'),
});
