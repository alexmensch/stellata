// The catalogue's system membership: WDS trees, CCDM groups and geometric pairs unioned into one tree per
// physical system, plus each record's companions with no record. See README.md.

import type { UnitVector } from '../../../src/astro-core/equatorial-basis';
import { ascending } from '../../../src/astro-core/order-pure';
import {
  FLAG_BINARY_COMPANION_ONLY, MULTIPLICITY_UNRESOLVED, VAR_TYPE_ECLIPSING,
} from '../../../src/catalog-format/record/catalog-pure';
import {
  EVIDENCE_SOURCES, NO_RECORD_COMPANIONS, nodeRecords,
  type EvidenceSource, type GroupNode, type MembershipSystem, type NoRecordCompanion, type SystemMembership, type SystemNode,
} from '../../../src/catalog-format/system-membership/system-membership-format';
import type { PromotedRow } from '../companions/companion-promotion';
import { isOpticalDoubleMember, type OpticalDoubleStar } from '../multiplicity/binary-flags-pure';
import type { SystemVerdict } from '../multiplicity/system-coherence';
import type { DoublesEvidence } from '../multiplicity/visual-doubles';
import { group, normalized, wdsTrees, type WdsPairEnds, type WdsTree, type WdsTreeCounts } from './wds-trees-pure';

export interface MembershipRecord extends OpticalDoubleStar {
  readonly flags: number;
}

export interface SystemMembershipInputs {
  /** Record order. */
  readonly records: readonly MembershipRecord[];
  readonly multiplicityStatus: Uint8Array;
  readonly wdsPairs: readonly WdsPairEnds[];
  readonly doubles: DoublesEvidence;
  readonly hipToIndex: ReadonlyMap<number, number>;
  /** The geometric pass's mutual pairs. */
  readonly geometricPairs: readonly (readonly [number, number])[];
  /** Records whose distance is not their own measurement (README.md#geometric-pairs). */
  readonly lentDistance: ReadonlySet<number>;
}

export type SystemMembershipCounts = WdsTreeCounts & {
  systems: number;
  systemRecords: number;
  /** Systems each source joined at least two records of. */
  systemsWithWds: number;
  systemsWithCcdm: number;
  systemsWithGeometric: number;
  /** CCDM members the optical-double gate dropped. */
  systemCcdmOpticalMembers: number;
  /** Geometric mutual pairs dropped because a member's distance is lent. */
  systemGeometricLentPairs: number;
  companionEclipsingPartner: number;
  companionSimbadMultiple: number;
  companionCcdm: number;
};

/** The records coherence snapped or promotion re-curated onto their anchor's distance; call before the record sort, which the set survives. */
export function anchorMovedRecords<S>(
  stars: readonly S[],
  verdicts: readonly SystemVerdict[],
  promoted: readonly Pick<PromotedRow, 'outcome'>[],
): Set<S> {
  const moved = new Set<S>();
  for (const v of verdicts) if (v.kind === 'coherent') for (const m of v.members) if (m.kind === 'snapped') moved.add(stars[m.idx]);
  for (const { outcome: o } of promoted) if (o.kind === 'adopted' && o.via !== 'earlier-mint' && o.recurated !== null) moved.add(stars[o.idx]);
  return moved;
}

/** A record whose distance came from another record: a minted companion, a lent sibling parallax, or a member moved onto its anchor. */
export function lentDistanceRecords<S extends { readonly flags: number; readonly distVia: MembershipRecord['distVia'] }>(
  records: readonly S[],
  movedOntoAnchor: ReadonlySet<S>,
): Set<number> {
  const lent = new Set<number>();
  records.forEach((s, i) => {
    if ((s.flags & FLAG_BINARY_COMPANION_ONLY) !== 0 || s.distVia === 'pair_member_parallax' || movedOntoAnchor.has(s)) lent.add(i);
  });
  return lent;
}

class Components {
  private readonly parent = new Map<number, number>();

  find(x: number): number {
    let root = x;
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
    this.parent.set(x, root);
    return root;
  }

  link(records: readonly number[]): void {
    for (const r of records.slice(1)) {
      const a = this.find(records[0]);
      const b = this.find(r);
      if (a !== b) this.parent.set(Math.max(a, b), Math.min(a, b));
    }
  }
}

function nestWithPartner(node: SystemNode, record: number, partner: number): SystemNode {
  if (node.kind === 'record') {
    return node.record === record ? group(null, [node, { kind: 'record', record: partner }]) : node;
  }
  return group(node.component, node.children.map((c) => nestWithPartner(c, record, partner)));
}

interface ComponentEvidence {
  trees: WdsTree[];
  ccdm: number[][];
  geometric: (readonly [number, number])[];
}

function systemOf(e: ComponentEvidence): MembershipSystem {
  const unlabelledTree = e.trees.length === 1 && e.trees[0].root.component === null;
  let base: SystemNode[] = unlabelledTree ? [...e.trees[0].root.children] : e.trees.map((t) => t.root);
  const placed = new Set(base.flatMap(nodeRecords));
  const extras: SystemNode[] = [];
  for (const [a, b] of e.geometric) {
    if (placed.has(a) && placed.has(b)) continue;
    if (!placed.has(a) && !placed.has(b)) {
      extras.push(group(null, [{ kind: 'record', record: a }, { kind: 'record', record: b }]));
    } else {
      const [inside, outside] = placed.has(a) ? [a, b] : [b, a];
      base = base.map((n) => nestWithPartner(n, inside, outside));
    }
    placed.add(a);
    placed.add(b);
  }
  for (const r of [...new Set(e.ccdm.flat())].sort(ascending)) {
    if (!placed.has(r)) { extras.push({ kind: 'record', record: r }); placed.add(r); }
  }
  const root = normalized(group(null, [...base, ...extras]));
  if (root?.kind !== 'group') throw new Error(`system membership: a component of ${placed.size} records formed no group`);
  const has: Record<EvidenceSource, boolean> = { wds: e.trees.length > 0, ccdm: e.ccdm.length > 0, geometric: e.geometric.length > 0 };
  return { sources: EVIDENCE_SOURCES.filter((s) => has[s]), root: root as GroupNode };
}

function companionsOf(inputs: SystemMembershipInputs, ccdmSingles: ReadonlySet<number>): Map<number, NoRecordCompanion[]> {
  const out = new Map<number, NoRecordCompanion[]>();
  inputs.records.forEach((s, i) => {
    const has: Record<NoRecordCompanion, boolean> = {
      'eclipsing-partner': s.varType === VAR_TYPE_ECLIPSING,
      'simbad-multiple': inputs.multiplicityStatus[i] === MULTIPLICITY_UNRESOLVED,
      'ccdm-companion': ccdmSingles.has(i),
    };
    const kinds = NO_RECORD_COMPANIONS.filter((k) => has[k]);
    if (kinds.length > 0) out.set(i, kinds);
  });
  return out;
}

export function buildSystemMembership(inputs: SystemMembershipInputs): { membership: SystemMembership; counts: SystemMembershipCounts } {
  const direction = (i: number): UnitVector => {
    const s = inputs.records[i];
    const d = Math.hypot(s.x, s.y, s.z);
    return { x: s.x / d, y: s.y / d, z: s.z / d };
  };
  const wds = wdsTrees(inputs.wdsPairs, direction);

  const ccdmGroups: number[][] = [];
  const ccdmSingles = new Set<number>();
  let systemCcdmOpticalMembers = 0;
  for (const hips of inputs.doubles.groups) {
    const members = [...new Set(hips.flatMap((h) => inputs.hipToIndex.get(h) ?? []))].sort(ascending);
    if (members.length === 1) ccdmSingles.add(members[0]);
    if (members.length < 2) continue;
    const kept = members.filter((m) => !isOpticalDoubleMember(m, members, inputs.records, inputs.doubles.optical));
    systemCcdmOpticalMembers += members.length - kept.length;
    if (kept.length >= 2) ccdmGroups.push(kept);
  }

  const geometric = inputs.geometricPairs
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as const)
    .sort((p, q) => ascending(p[0], q[0]) || ascending(p[1], q[1]));
  const qualified = geometric.filter(([a, b]) => !inputs.lentDistance.has(a) && !inputs.lentDistance.has(b));

  const components = new Components();
  for (const t of wds.trees) components.link(nodeRecords(t.root));
  for (const g of ccdmGroups) components.link(g);
  for (const p of qualified) components.link(p);

  const evidence = new Map<number, ComponentEvidence>();
  const at = (r: number): ComponentEvidence => {
    const key = components.find(r);
    let e = evidence.get(key);
    if (!e) evidence.set(key, (e = { trees: [], ccdm: [], geometric: [] }));
    return e;
  };
  for (const t of wds.trees) at(nodeRecords(t.root)[0]).trees.push(t);
  for (const g of ccdmGroups) at(g[0]).ccdm.push(g);
  for (const p of qualified) at(p[0]).geometric.push(p);

  const systems = [...evidence.entries()].sort((a, b) => ascending(a[0], b[0])).map(([, e]) => systemOf(e));
  const companions = companionsOf(inputs, ccdmSingles);
  const withSource = (s: EvidenceSource) => systems.filter((sys) => sys.sources.includes(s)).length;
  const kindCount = (k: NoRecordCompanion) => [...companions.values()].filter((ks) => ks.includes(k)).length;
  return {
    membership: { systems, companions },
    counts: {
      ...wds.counts,
      systems: systems.length,
      systemRecords: systems.reduce((n, s) => n + nodeRecords(s.root).length, 0),
      systemsWithWds: withSource('wds'),
      systemsWithCcdm: withSource('ccdm'),
      systemsWithGeometric: withSource('geometric'),
      systemCcdmOpticalMembers,
      systemGeometricLentPairs: geometric.length - qualified.length,
      companionEclipsingPartner: kindCount('eclipsing-partner'),
      companionSimbadMultiple: kindCount('simbad-multiple'),
      companionCcdm: kindCount('ccdm-companion'),
    },
  };
}

export function systemMembershipSummary(c: SystemMembershipCounts): string {
  return `system membership: ${c.systems} systems over ${c.systemRecords} records (WDS ${c.systemsWithWds}, CCDM ${c.systemsWithCcdm}, `
    + `geometric ${c.systemsWithGeometric}); WDS shared records ${c.systemWdsIdentityGated} identity-gated, ${c.systemWdsAmbiguous} ambiguous, `
    + `${c.systemWdsTokenConflicts} token conflicts; ${c.systemCcdmOpticalMembers} optical CCDM members, `
    + `${c.systemGeometricLentPairs} geometric pairs on a lent distance; no-record companions: ${c.companionEclipsingPartner} eclipsing, `
    + `${c.companionSimbadMultiple} SIMBAD multiple, ${c.companionCcdm} CCDM`;
}
