// See README.md#both-gates-weigh-every-candidate.

import { readTable, type TableSpec } from '../../../util/tsv/table-pure';
import { parseGaiaSourceIdStr } from '../../record/catalog-pure';
import type { PrintedV, PrintedVLookups } from '../../photometry/v-magnitude-pure';

/** Magnitude-consistency gate for Gaia source bindings, shared with the
 *  binaries pipeline: keep equal to GAIA_BINDING_G_MINUS_V_REJECT_MAG in
 *  scripts/binaries/indices.py (binding-gate-pure.test.ts cross-checks the
 *  Python source text). A bound source more than this much fainter in G
 *  than the star's V is not the star — Gaia's fit fails on saturated
 *  bright stars, so both AT-HYG's `gaia` cell and the
 *  hipparcos2_best_neighbour cross-walk can land on a resolvable
 *  companion or background star instead (Toliman → a G=20.95 source,
 *  Castor → Castor B's source). */
export const GAIA_BINDING_G_MINUS_V_REJECT_MAG = 1.0;

/** One (wds_id, component) attribution parsed from
 *  data/simbad/simbad_wds_xids.tsv. */
export interface WdsComponentAttribution {
  wdsId: string;
  component: string;
}

/** SIMBAD WDS cross-IDs indexed for the sibling-letter gate below.
 *  One source or HIP can carry several attributions (blended sources,
 *  blend-suffixed HIPs, multi-system membership), so values are arrays.
 *  `primarySourceLetterByWds` is each system's lexicographically-first
 *  component letter among those carrying their own Gaia source — the
 *  letter a system-level (blend-HIP) AT-HYG row should key on. */
export interface SimbadWdsXidIndex {
  bySource: Map<string, WdsComponentAttribution[]>;
  byHip: Map<number, WdsComponentAttribution[]>;
  primarySourceLetterByWds: Map<string, string>;
}

const SIMBAD_WDS_XIDS = {
  file: 'data/simbad/simbad_wds_xids.tsv',
  columns: ['wds_id', 'component', 'gaia_source_id', 'hip'] as const,
  hint: 'Re-run scripts/refresh/refresh-simbad-wds-xids.py.',
} satisfies TableSpec<string>;

/** Parse data/simbad/simbad_wds_xids.tsv (refresh-simbad-wds-xids.py)
 *  into per-source and per-HIP WDS-component attribution maps. Source
 *  ids stay strings — they exceed Number.MAX_SAFE_INTEGER. */
export function parseSimbadWdsXidsTsv(text: string): SimbadWdsXidIndex {
  const bySource = new Map<string, WdsComponentAttribution[]>();
  const byHip = new Map<number, WdsComponentAttribution[]>();
  const primarySourceLetterByWds = new Map<string, string>();
  for (const row of readTable(SIMBAD_WDS_XIDS, text)) {
    const wdsId = row.text('wds_id');
    const component = row.text('component');
    if (wdsId === null || component === null) continue;
    const attr: WdsComponentAttribution = { wdsId, component };
    const src = parseGaiaSourceIdStr(row.raw('gaia_source_id'));
    if (src) {
      const list = bySource.get(src);
      if (list) list.push(attr);
      else bySource.set(src, [attr]);
      const p = primarySourceLetterByWds.get(wdsId);
      if (p === undefined || component < p) {
        primarySourceLetterByWds.set(wdsId, component);
      }
    }
    const hip = row.int('hip');
    if (hip !== null && hip > 0) {
      const list = byHip.get(hip);
      if (list) list.push(attr);
      else byHip.set(hip, [attr]);
    }
  }
  return { bySource, byHip, primarySourceLetterByWds };
}

/** 'A' vs 'B' are disjoint siblings; 'A' vs 'Aa' are one lineage (the
 *  sub-letter carries the parent's light), so only a non-prefix-related
 *  pair counts as a different star. */
function wdsComponentsDisjoint(a: string, b: string): boolean {
  return !a.startsWith(b) && !b.startsWith(a);
}

/** Sibling-letter attribution gate — the catalog-boundary mirror of the
 *  binaries pipeline's identity refutation (stage2_resolve.py): true
 *  when SIMBAD's WDS cross-IDs give one component letter sole ownership
 *  of `sourceId` while the row's own identity points at a different
 *  letter of the same system. Gaia's HIP best-neighbour cross-walk (and
 *  AT-HYG's `gaia` cell, which ingests it) lands a saturated primary's
 *  HIP on the resolvable sibling's source when both are similar
 *  brightness, so the G−V gate misses it (HIP 83608 = μ Dra A carries
 *  μ Dra B's source; HIP 41098 carries HD 70492 B's).
 *
 *  Per system where `sourceId` is attributed to exactly one letter X:
 *  - the row's HIP attributed only to letters compatible with X (same
 *    lineage) → the row IS X; cleared.
 *  - attributed only to letters disjoint from X → the row is a
 *    different star; scrubbed.
 *  - attributed to both (blend-suffixed `HIP nA`/`HIP nB`), or absent
 *    from the system's per-component xids (Hipparcos blend entries live
 *    on SIMBAD system-level objects) → the AT-HYG row is the system
 *    record and must key on the primary lineage: scrubbed when the
 *    system's source-bearing primary letter is disjoint from X, unless
 *    `rowNamesSource` (/scripts/catalog/membership/binding/README.md#both-gates-weigh-every-candidate). */
export function isSiblingLetterAttribution(
  sourceId: string,
  hip: number | null,
  xids: SimbadWdsXidIndex | null,
  rowNamesSource = false,
): boolean {
  if (hip === null || xids === null) return false;
  const srcAttrs = xids.bySource.get(sourceId);
  if (!srcAttrs) return false;
  const hipAttrs = xids.byHip.get(hip) ?? [];
  for (const wdsId of new Set(srcAttrs.map((a) => a.wdsId))) {
    const sLetters = new Set(
      srcAttrs.filter((a) => a.wdsId === wdsId).map((a) => a.component),
    );
    if (sLetters.size !== 1) continue; // photocentre blend — no sole owner
    const x = [...sLetters][0];
    const hLetters = hipAttrs
      .filter((a) => a.wdsId === wdsId)
      .map((a) => a.component);
    if (hLetters.length > 0) {
      const anyRelated = hLetters.some((l) => !wdsComponentsDisjoint(l, x));
      const anyDisjoint = hLetters.some((l) => wdsComponentsDisjoint(l, x));
      if (anyRelated && !anyDisjoint) continue;
      if (anyDisjoint && !anyRelated) return true;
    }
    if (rowNamesSource && hLetters.some((l) => !wdsComponentsDisjoint(l, x))) continue;
    const p = xids.primarySourceLetterByWds.get(wdsId);
    if (p !== undefined && wdsComponentsDisjoint(p, x)) return true;
  }
  return false;
}

/** Per-source photometry the binding gate below needs. `gMagOf` is Gaia's
 *  own G for the candidate source; `printedV` the V cascade's printed tiers,
 *  so both gates weigh a row on the evidence the record side reaches
 *  (`../../photometry/README.md#the-v-cascade`). Both cross-walks feeding this
 *  join are best-neighbour tables, so an unvetted row can assert that a
 *  saturated star's designations belong to the faint companion Gaia actually
 *  fitted. */
export interface BindingEvidence {
  gMagOf: (sourceId: string) => number | null;
  /** A missing G is a PASS at the gate either way, so the two causes have to
   *  be told apart: no row means the request under-covers the candidate set
   *  and is fixable there, while a row with a null `phot_g_mean_mag` is a
   *  source Gaia publishes no G for and no request can supply. */
  hasPulledRow: (sourceId: string) => boolean;
  printedV: PrintedVLookups;
  wdsXids: SimbadWdsXidIndex | null;
}

export function bindingEvidence(
  sourceGMag: ReadonlyMap<string, number>,
  wdsXids: SimbadWdsXidIndex | null,
  printedV: PrintedVLookups,
  pulledSourceIds: ReadonlySet<string> | ReadonlyMap<string, unknown> | null = null,
): BindingEvidence {
  return {
    gMagOf: (sourceId) => sourceGMag.get(sourceId) ?? null,
    hasPulledRow: (sourceId) => (pulledSourceIds ?? sourceGMag).has(sourceId),
    printedV,
    wdsXids,
  };
}

export type GateReason = 'mag' | 'sibling';

/** Why a candidate's G could not be held against a printed V: the row has no
 *  printed V, the astrometry pull returned no row for the source (the request
 *  under-covering its candidates), or Gaia publishes no G for it. */
export type Unweighable = 'no_printed_v' | 'no_pulled_row' | 'null_g';

/** How the magnitude arm went: G held against the printed V and consistent,
 *  held and refused, or not weighable and why. */
export type MagnitudeOutcome = 'consistent' | 'rejected' | Unweighable;

/** `siblingRefused` is false on a magnitude rejection: the sibling arm does
 *  not run then. */
export interface BindingVerdict {
  magnitude: MagnitudeOutcome;
  siblingRefused: boolean;
}

/** The gate that refused the candidate, or null where it binds. */
export function rejectionOf({ magnitude, siblingRefused }: BindingVerdict): GateReason | null {
  if (magnitude === 'rejected') return 'mag';
  return siblingRefused ? 'sibling' : null;
}

/** What a candidate is weighed against: the HIP the sibling gate keys on and
 *  the printed V the magnitude gate compares G with. */
export interface GateRow {
  hip: number | null;
  printedV: PrintedV | null;
}

/** Both binding gates, the one weighing the overlay join and the membership
 *  derivation share. */
export function weighBinding(
  sourceId: string, row: GateRow, evidence: BindingEvidence,
): BindingVerdict {
  const magnitude = magnitudeOutcome(sourceId, row.printedV, evidence);
  const siblingRefused = magnitude !== 'rejected'
    && isSiblingLetterAttribution(sourceId, row.hip, evidence.wdsXids);
  return { magnitude, siblingRefused };
}

function magnitudeOutcome(
  sourceId: string, printedV: PrintedV | null, evidence: BindingEvidence,
): MagnitudeOutcome {
  if (printedV === null) return 'no_printed_v';
  const g = evidence.gMagOf(sourceId);
  if (g === null) return evidence.hasPulledRow(sourceId) ? 'null_g' : 'no_pulled_row';
  return g - printedV.vMag > GAIA_BINDING_G_MINUS_V_REJECT_MAG ? 'rejected' : 'consistent';
}
