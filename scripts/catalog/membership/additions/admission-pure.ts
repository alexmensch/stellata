// The additions phase: items grouped into stars, each group bound through the shared derivation and admitted under the collision guard, or ledgered as a component. See README.md#grouping-and-admission.

import { normaliseGjKey } from '../../simbad/simbad-namespace-ladder-pure';
import type { Cns5Row } from '../../classic-ids/classic-ids-parse';
import type { LabelMergeRecord } from '../../classic-ids/label-merge/label-merge-pure';
import type { SpineRow } from '../../spine/inherited-spine-pure';
import {
  ATHYG_HD_LINK_FLOOR,
  type HdAddition,
  type HipAddition,
  type PrimaryIndex,
  type PrimaryTables,
} from '../../spine/primaries-audit-pure';
import { UnionFind, compareDesignations } from '../../../sid/sid-pure';
import { nullableCell } from '../../../util/tsv/artifact-pure';
import { identityRow, type IdentityCells, type IdentityRow } from '../../lineage/identity-pure';
import {
  BINDING_SOURCES,
  type BindingSource,
  type DerivedBinding,
} from '../binding/binding-derivation-pure';
import {
  heldMoreThanOnce,
  passingRunnersUp,
  refusedCandidates,
  unshippedCandidates,
  unweighedCandidates,
  type RowDeriver,
  type UnshippedCandidate,
} from '../binding/binding-outcomes-pure';
import { attestRow, routedRow } from '../label-attestation-pure';
import type { AdditionReason } from '../ledger-rows-pure';
import {
  LED_ADDITION_OUTCOMES,
  withLead,
  type AdditionBindingClass,
  type AdditionBindingOutcome,
  type KeyedOutcome,
  type OriginKeys,
} from '../membership-lineage-pure';
import {
  manifestDesignations,
  primariesManifestRecord,
  type ManifestRecord,
} from '../membership-manifest-tsv';
import {
  additionCells,
  additionCohortItems,
  cns5Gl,
  soleItem,
  type AdditionCohortItem,
  type AdditionCohorts,
} from './addition-items-pure';

function pushKeyed<K, V>(by: Map<K, V[]>, key: K, value: V): void {
  const list = by.get(key);
  if (list === undefined) by.set(key, [value]);
  else list.push(value);
}

/** Seeded from the spine after the label merge and GROWN as each addition is
 *  admitted, so two addition groups cannot take one designation either
 *  (/docs/sid.md#41-same-as-equivalence-graph). */
interface Claims {
  hd: Set<number>;
  hr: Set<number>;
  hip: Set<number>;
  /** Keyed by `normaliseGjKey` form (number + component letter); the value is
   *  the claiming record's own designation, which is what a component row has
   *  to name. */
  gl: Map<string, string>;
  /** The spine's alone, and it needs no sequential growth: `sharedSources`
   *  drops any raw source two addition groups reach, so no admitted row can
   *  take a source another group would have. */
  gaia: Set<string>;
}

/** The `gl:` designation a record answers to — `starDesignations`' form, which
 *  is the raw cell and not the normalised key. */
function glDesignation(cell: string): string {
  return `gl:${cell.trim().replace(/\s+/g, '_')}`;
}

/** Matched on the normalised key alone, LETTER INCLUDED — never the bare
 *  number, which is the cohort filter's question and `spineKeys`' to
 *  answer. */
function claimedGl(claims: Claims, key: string): string | null {
  return claims.gl.get(key) ?? null;
}

function claimRecord(claims: Claims, r: LabelMergeRecord): void {
  if (r.hd !== null) claims.hd.add(r.hd);
  for (const hd of r.hdAlt) claims.hd.add(hd);
  if (r.hr !== null) claims.hr.add(r.hr);
  for (const hr of r.hrAlt) claims.hr.add(hr);
  if (r.hip !== null) claims.hip.add(r.hip);
  const gl = normaliseGjKey(r.gl);
  if (gl !== null && r.gl !== null) claims.gl.set(gl, glDesignation(r.gl));
}

function spineClaims(records: readonly LabelMergeRecord[]): Claims {
  const claims: Claims = {
    hd: new Set(), hr: new Set(), hip: new Set(), gl: new Map(), gaia: new Set(),
  };
  for (const r of records) {
    claimRecord(claims, r);
    if (r.gaiaSourceId !== null) claims.gaia.add(r.gaiaSourceId);
  }
  return claims;
}

interface AdditionItem extends AdditionCohortItem {
  /** What this item alone derives — two items deriving one source are one star. */
  derived: DerivedBinding;
}

/** Designation-keyed indexes over the primaries the additions join through. */
interface AdditionIndex {
  hrByHd: Map<number, number[]>;
  hipByHdIv27a: Map<number, number[]>;
  flamByHd: Map<number, number>;
  flamByHip: Map<number, number>;
}

function indexAdditions(tables: PrimaryTables): AdditionIndex {
  const hrByHd = new Map<number, number[]>();
  for (const r of tables.v50) {
    if (r.hd === null) continue;
    pushKeyed(hrByHd, r.hd, r.hr);
  }
  const hipByHdIv27a = new Map<number, number[]>();
  const flamByHd = new Map<number, number>();
  const flamByHip = new Map<number, number>();
  for (const r of tables.iv27a) {
    if (r.hip !== null) pushKeyed(hipByHdIv27a, r.hd, r.hip);
    if (r.flamsteed === null) continue;
    if (!flamByHd.has(r.hd)) flamByHd.set(r.hd, r.flamsteed);
    if (r.hip !== null && !flamByHip.has(r.hip)) flamByHip.set(r.hip, r.flamsteed);
  }
  return { hrByHd, hipByHdIv27a, flamByHd, flamByHip };
}

/** Two TYC items are two Tycho-2 stars whatever the best-neighbour walk
 *  says, and take no side. */
function groupAdditions(
  items: readonly AdditionItem[],
  tables: PrimaryTables,
  index: AdditionIndex,
): AdditionItem[][] {
  const uf = new UnionFind();
  const byKey = new Map(items.map((i) => [i.key, i]));
  for (const i of items) uf.add(i.key);
  const hipKey = (hip: number): string => `hip:${hip}`;
  for (const i of items) {
    if (i.hd === null) continue;
    const tycho2Hip = tables.tycho2.get(i.hd.tyc)?.hip ?? null;
    const linked = tycho2Hip === null ? [] : [tycho2Hip];
    for (const hd of i.hd.hds) linked.push(...(index.hipByHdIv27a.get(hd) ?? []));
    for (const hip of linked) {
      if (byKey.has(hipKey(hip))) uf.union(i.key, hipKey(hip));
    }
  }
  const bySource = new Map<string, AdditionItem[]>();
  for (const i of items) {
    if (i.derived.sourceId === null) continue;
    pushKeyed(bySource, i.derived.sourceId, i);
  }
  for (const list of bySource.values()) {
    const tycItems = list.filter((i) => i.hd !== null);
    const rest = list.filter((i) => i.hd === null);
    const anchor = tycItems.length === 1 ? tycItems[0] : rest[0];
    if (anchor === undefined) continue;
    for (const i of rest) uf.union(anchor.key, i.key);
  }
  const groups = new Map<string, AdditionItem[]>();
  for (const i of items) pushKeyed(groups, uf.find(i.key), i);
  return [...groups.values()];
}

/** One star's items merged across the primaries, with the derivation's verdict
 *  on the source they reach. Everything admission needs except the claim set,
 *  which grows under it — so these are resolved before the first group is
 *  admitted and fix the order the contested designations go in. */
interface AdditionGroup {
  hd: HdAddition | null;
  hip: HipAddition | null;
  cns5: Cns5Row | null;
  rawGl: string | null;
  tyc: string;
  source: string | null;
  binding: AdditionBindingClass;
  derived: DerivedBinding;
  sourceOnSpine: boolean;
  /** The TYC and HIP routes' candidates, where both propose one and they differ. */
  routeDisagreement: { tyc: string; hip: string } | null;
  /** The anchor item's source row — IV/25, else I/239, else CNS5 — with the
   *  other items' rows as evidence. */
  origin: string;
  members: string[];
}

const ORIGIN_LADDER = ['hd', 'hip', 'cns5'] as const;

function originRank(item: AdditionCohorts): number {
  const rank = ORIGIN_LADDER.findIndex((c) => item[c] !== null);
  if (rank < 0) throw new Error('addition item holds no cohort row');
  return rank;
}

function itemOrigin(item: AdditionCohorts, keys: OriginKeys): string {
  switch (ORIGIN_LADDER[originRank(item)]) {
    case 'hd': return keys.iv25(item.hd!.tyc);
    case 'hip': return keys.i239(item.hip!.hip);
    case 'cns5': return keys.cns5(item.cns5!.cns5);
  }
}

function candidateVia(d: DerivedBinding, source: BindingSource): string | null {
  return d.ranked.find((c) => c.via.includes(source))?.sourceId ?? null;
}

function additionGroup(
  items: readonly AdditionItem[],
  derived: DerivedBinding,
  claims: Claims,
  sharedSources: ReadonlySet<string>,
  keys: OriginKeys,
): AdditionGroup {
  // One item per cohort is what the grouping rules produce and what admission
  // reads; a second would leave a primary's row in no manifest row and on no
  // ledger line, which record parity (/docs/catalog-driver.md#61-record-parity) forbids outright. Loud beats silent: the shape is
  // new, and what it should admit is a decision, not a default.
  for (const cohort of ['hd', 'hip', 'cns5'] as const) {
    const named = items.filter((i) => i[cohort] !== null);
    if (named.length > 1) {
      throw new Error(
        `addition group holds ${named.length} ${cohort} items (${named.map((i) => i.key).join(', ')}); `
          + 'groupAdditions merges one star\'s items, so admission drops all but the first',
      );
    }
  }
  const hd = soleItem(items, 'hd');
  const cns5 = soleItem(items, 'cns5');
  const winner = derived.sourceId;
  const sourceOnSpine = winner !== null && claims.gaia.has(winner);
  const source = winner !== null && !sourceOnSpine && !sharedSources.has(winner) ? winner : null;
  const tycSource = candidateVia(derived, 'tyc');
  const hipSource = candidateVia(derived, 'hip');
  const anchor = items.reduce((a, b) => (originRank(b) < originRank(a) ? b : a));
  return {
    origin: itemOrigin(anchor, keys),
    members: items.filter((i) => i !== anchor).map((i) => itemOrigin(i, keys)).sort(),
    hd, hip: soleItem(items, 'hip'), cns5,
    rawGl: cns5Gl(cns5),
    tyc: hd?.tyc ?? '',
    source,
    binding: source === null ? 'none' : derived.binding,
    derived,
    sourceOnSpine,
    routeDisagreement: tycSource !== null && hipSource !== null && tycSource !== hipSource
      ? { tyc: tycSource, hip: hipSource } : null,
  };
}

/** Two groups can arrive with the same designation and no spine record to lose
 *  it to — IV/25 resolving one HD onto two Tycho-2 stars is the shape, and it
 *  flags them `n_tyc > 1`. Admission is sequential, so this order decides which
 *  one takes the designation and which ledgers onto it as a component: the
 *  group whose Gaia binding survives the HD-route gate (/docs/catalog-driver.md#4-how-hd-reaches-gaia) first, since the other
 *  component would otherwise park for want of a parallax this one has, then by
 *  TYC, HIP and GJ — a total order over content, never over walk order. */
function additionGroupOrder(
  publishesGaiaParallax: (sourceId: string) => boolean,
): (a: AdditionGroup, b: AdditionGroup) => number {
  const rank = (g: AdditionGroup): number => (
    g.source === null ? 2 : publishesGaiaParallax(g.source) ? 0 : 1
  );
  return (a, b) => rank(a) - rank(b) || compareAdditionGroupCells(a, b);
}

function compareAdditionGroupCells(a: AdditionGroup, b: AdditionGroup): number {
  if (a.tyc !== b.tyc) return a.tyc < b.tyc ? -1 : 1;
  const hipA = a.hip?.hip ?? 0;
  const hipB = b.hip?.hip ?? 0;
  if (hipA !== hipB) return hipA - hipB;
  const glA = a.rawGl ?? '';
  const glB = b.rawGl ?? '';
  return glA < glB ? -1 : glA > glB ? 1 : 0;
}

interface Admission {
  verdict:
    /** `record` is the admitted row's, for the claim set. */
    | { kind: 'admitted'; reason: AdditionReason; row: ManifestRecord; record: LabelMergeRecord }
    /** Keyed on the cells it arrived with, since it becomes no row. */
    | { kind: 'component'; designation: string; cells: IdentityCells };
  /** Designations the guard withheld. Every one on a component row; on an
   *  admitted row it is a designation the primaries publish for this star that
   *  the record ships without, so the count is pinned. */
  blocked: readonly string[];
}

function admitGroup(
  group: AdditionGroup,
  claims: Claims,
  index: AdditionIndex,
): Admission {
  const { hd: hdItem, hip: hipItem, rawGl, tyc, source } = group;
  const blocked: string[] = [];

  const hds = [...(hdItem?.hds ?? [])].sort((a, b) => a - b).filter((hd) => {
    if (!claims.hd.has(hd)) return true;
    blocked.push(`hd:${hd}`);
    return false;
  });
  let hip: number | null = hipItem?.hip ?? null;
  if (hip !== null && claims.hip.has(hip)) {
    blocked.push(`hip:${hip}`);
    hip = null;
  }
  const hrs: number[] = [];
  for (const hd of hds) {
    for (const hr of index.hrByHd.get(hd) ?? []) {
      if (claims.hr.has(hr)) blocked.push(`hr:${hr}`);
      else if (!hrs.includes(hr)) hrs.push(hr);
    }
  }
  hrs.sort((a, b) => a - b);
  let gl = rawGl;
  const glKey = normaliseGjKey(gl);
  if (glKey !== null) {
    const held = claimedGl(claims, glKey);
    if (held !== null) {
      blocked.push(held);
      gl = null;
    }
  }
  let flam: number | null = null;
  for (const hd of hds) flam ??= index.flamByHd.get(hd) ?? null;
  if (hip !== null) flam ??= index.flamByHip.get(hip) ?? null;

  if (hds.length === 0 && hip === null && gl === null) {
    // Ledgered under the designations it arrived with; the first blocked one
    // in ladder order names the record it resolves onto.
    return {
      blocked,
      verdict: {
        kind: 'component',
        designation: blocked.sort(compareDesignations)[0],
        cells: {
          tyc,
          hip: nullableCell(hipItem?.hip ?? null),
          hd: nullableCell(hdItem === null ? null : Math.min(...hdItem.hds)),
          gl: rawGl ?? '',
          gaia_source_id: '',
        },
      },
    };
  }
  const reason: AdditionReason = hds.length > 0
    ? (hds[0] < ATHYG_HD_LINK_FLOOR ? 'admitted:hd_link_gap' : 'admitted:hd_omitted')
    : hip !== null ? 'admitted:hip_omitted' : 'admitted:cns5_census';
  const record: LabelMergeRecord = {
    gaiaSourceId: source,
    hip, hd: hds[0] ?? null, hr: hrs[0] ?? null, gl, flam,
    hdAlt: hds.slice(1), hrAlt: hrs.slice(1),
  };
  const row = primariesManifestRecord({ tyc, bayer: '', proper: '' }, record, group.binding, group.origin);
  return { blocked, verdict: { kind: 'admitted', reason, row, record } };
}

function additionBindingOutcome(g: AdditionGroup): AdditionBindingOutcome {
  if (g.derived.sourceId === null) return g.derived.ranked.length > 0 ? 'refused' : 'no-candidate';
  if (g.sourceOnSpine) return 'on-spine';
  if (g.source === null) return 'shared';
  return g.derived.rescued ? 'rescued' : 'bound';
}

export interface AdditionsPhase {
  /** The admitted rows, in admission order. */
  rows: ManifestRecord[];
  outcomes: KeyedOutcome[];
  /** The component groups', which become no row. */
  identity: IdentityRow[];
  unshipped: UnshippedCandidate[];
}

export function admitAdditions(input: {
  tables: PrimaryTables;
  idx: PrimaryIndex;
  /** The spine as the corrections leave it, which the cohorts are measured against. */
  kept: readonly SpineRow[];
  /** The spine side's label-merged records: the claims admission starts from. */
  spineRecords: readonly LabelMergeRecord[];
  derive: RowDeriver;
  keys: OriginKeys;
  publishesGaiaParallax: (sourceId: string) => boolean;
}): AdditionsPhase {
  const { tables, idx, derive, keys } = input;
  const claims = spineClaims(input.spineRecords);
  const items: AdditionItem[] = additionCohortItems(tables, input.kept, idx).map((i) => ({
    ...i, derived: derive(additionCells([i])).derived,
  }));
  const index = indexAdditions(tables);
  const derivedGroups = groupAdditions(items, tables, index).map((g) => ({
    items: g, derived: g.length === 1 ? g[0].derived : derive(additionCells(g)).derived,
  }));
  const sharedSources = heldMoreThanOnce(derivedGroups.map(({ derived }) => derived.sourceId));

  const out: AdditionsPhase = { rows: [], outcomes: [], identity: [], unshipped: [] };
  const groups = derivedGroups.map(({ items: groupItems, derived }) => {
    const group = additionGroup(groupItems, derived, claims, sharedSources, keys);
    const weighedBy = groupItems.map((item) => {
      const at = itemOrigin(item, keys);
      return { d: item.derived, cites: at === group.origin ? [] : [at] };
    });
    if (groupItems.length > 1) weighedBy.push({ d: derived, cites: [] });
    out.outcomes.push(...unweighedCandidates(group.origin, weighedBy));
    return group;
  }).sort(additionGroupOrder(input.publishesGaiaParallax));

  for (const g of groups) {
    const a = admitGroup(g, claims, index);
    if (g.source !== null && passingRunnersUp(g.derived).length > 0) {
      out.outcomes.push({ key: g.origin, outcome: { kind: 'addition-contested' } });
    }
    const component = a.verdict.kind === 'component';
    if (component && g.derived.sourceId !== null) {
      out.unshipped.push({ sourceId: g.derived.sourceId, candidate: { reason: 'component', of: g.origin } });
    }
    out.unshipped.push(...unshippedCandidates(g.origin, g.derived, component ? null : g.source));
    if (g.routeDisagreement !== null) {
      out.outcomes.push({ key: g.origin, outcome: {
        kind: 'route-disagree', tycSourceId: g.routeDisagreement.tyc, hipSourceId: g.routeDisagreement.hip,
      } });
    }
    out.outcomes.push(
      { key: g.origin, outcome: {
        kind: 'addition-binding', ...withLead(additionBindingOutcome(g), LED_ADDITION_OUTCOMES, g.derived.via, BINDING_SOURCES),
        sourceId: g.derived.sourceId ?? '', via: g.derived.via.join('+'),
      } },
      ...refusedCandidates(g.origin, 'addition', g.derived),
    );
    if (a.verdict.kind === 'component') {
      out.outcomes.push({
        key: g.origin,
        outcome: { kind: 'component', designation: a.verdict.designation, members: g.members },
      });
      out.identity.push(identityRow(g.origin, a.verdict.cells, [...a.blocked].sort(compareDesignations)));
      continue;
    }
    out.outcomes.push({
      key: g.origin, outcome: { kind: 'admit-addition', reason: a.verdict.reason, binding: g.binding, members: g.members },
    });
    if (a.blocked.length > 0) {
      out.outcomes.push({ key: g.origin, outcome: {
        kind: 'blocked-designation', designations: [...a.blocked].sort(compareDesignations),
      } });
    }
    const designations = manifestDesignations(a.verdict.row);
    if (designations.length === 1 && designations[0].startsWith('gaia_dr3:')) {
      throw new Error(
        `admitted addition ${g.origin} keys on its Gaia id alone (${designations[0]}); a primaries `
          + 'addition ships at least one classical designation, or it is ledgered as a component',
      );
    }
    claimRecord(claims, a.verdict.record);
    const attested = routedRow(attestRow(a.verdict.row, tables, idx));
    out.outcomes.push(...attested.outcomes);
    out.rows.push(attested.row);
  }
  return out;
}
