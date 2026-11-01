// SID allocation: every object resolved, minted or reinstated against the ledger, every SID no object reaches settled by the upstream decision that removed it, and the events that follow. See /docs/sid.md#44-allocation.

import type { CodeEffect } from '../catalog/lineage/reason-codes-pure';
import { retiredSids, type EventRow } from './events-pure';
import {
  canonicalKeyOf, parseDesignation, sameAsClasses,
  type AmbiguousDesignation, type LedgerRow, type SameasEdge, type SidKind,
} from './sid-pure';

/** How the object came to be in the build: through a lineage stage's admission row, or by a list the allocating step owns. */
export type Admission =
  | { readonly kind: 'lineage'; readonly origin: string }
  | { readonly kind: 'declared'; readonly code: string; readonly origin: string | null };

export interface SidObject {
  readonly designations: readonly string[];
  readonly kind: SidKind;
  readonly label: string;
  readonly admission: Admission;
}

export type RemovalEffect = Exclude<CodeEffect, 'none'>;

export interface Decision {
  readonly stage: string;
  readonly origin: string;
  readonly code: string;
  readonly effect: RemovalEffect;
  /** For a merge: the origin key of the record it merges into, when the stage names one. */
  readonly into: string | null;
}

/** What the lineage says about a record carrying a ledger key: the removal decisions on it, and every stage that holds such a record at all. */
export interface Causes {
  readonly decisions: readonly Decision[];
  readonly seenBy: readonly string[];
}

/** Lineage lookups, asked once each and only for what allocation needs. */
export interface Upstream {
  causes(canonicalKeys: readonly string[]): ReadonlyMap<string, Causes>;
  /** The admitting code per lineage origin; an origin no stage admits is absent. */
  admissions(origins: readonly string[]): ReadonlyMap<string, string>;
}

export interface AllocateInput {
  readonly objects: readonly SidObject[];
  readonly storedEdges: readonly SameasEdge[];
  readonly ledger: readonly LedgerRow[];
  readonly events: readonly EventRow[];
  /** Whether this caller allocates a ledger namespace: only a SID keyed in one can leave its build. */
  readonly scope: (ns: string) => boolean;
  readonly date: string;
  readonly version: string;
}

export type ObjectOutcome =
  | { readonly kind: 'resolved'; readonly sid: number; readonly via: string }
  | { readonly kind: 'minted'; readonly sid: number; readonly canonicalKey: string; readonly code: string }
  | { readonly kind: 'reinstated'; readonly sid: number; readonly code: string };

export type SidRemoval =
  | { readonly kind: 'merged'; readonly sid: number; readonly canonicalKey: string; readonly into: number; readonly decision: Decision }
  | { readonly kind: 'retired'; readonly sid: number; readonly canonicalKey: string; readonly decision: Decision }
  | { readonly kind: 'parked'; readonly sid: number; readonly canonicalKey: string; readonly decision: Decision };

export type Allocation =
  | { readonly kind: 'failed'; readonly errors: readonly string[]; readonly ambiguous: readonly AmbiguousDesignation[] }
  | {
    readonly kind: 'allocated';
    /** Per object, in input order. */
    readonly outcomes: readonly ObjectOutcome[];
    readonly removals: readonly SidRemoval[];
    readonly minted: readonly LedgerRow[];
    /** Removals in ledger order, then mints and reinstates in object order. */
    readonly events: readonly EventRow[];
    readonly ambiguous: readonly AmbiguousDesignation[];
  };

const CLASSICAL = new Set(['sol', 'hip', 'hd', 'hr', 'gl']);

/** /docs/sid.md#43-ledger--datasidledgertsv: the classical key the merged record keys on survives; with none, the oldest SID. */
export function mergeSurvivor(active: readonly LedgerRow[]): LedgerRow {
  const key = canonicalKeyOf(active.map((r) => r.canonicalKey));
  const named = active.find((r) => r.canonicalKey === key);
  if (named !== undefined && CLASSICAL.has(parseDesignation(key).ns)) return named;
  return active.reduce((a, b) => (b.sid < a.sid ? b : a));
}

type Settled =
  | { readonly kind: 'parked' | 'retired'; readonly decision: Decision }
  | { readonly kind: 'merged'; readonly decision: Decision; readonly into: number }
  | { readonly kind: 'refused'; readonly why: string };

const decisionText = (d: Decision): string => `${d.code} on ${d.origin}`;

/** A park outranks a retire, so a SID stays live while any stage only parks its record; a merge mixed with anything else is refused. */
export function settleRemoval(causes: Causes, sidOfOrigin: (origin: string) => number | undefined): Settled {
  const { decisions, seenBy } = causes;
  if (decisions.length === 0) {
    return {
      kind: 'refused',
      why: seenBy.length === 0
        ? 'no lineage stage holds a record carrying it'
        : `${seenBy.join(' and ')} hold${seenBy.length === 1 ? 's' : ''} its record with no retire, park or merge decision`,
    };
  }
  const merges = decisions.filter((d) => d.effect === 'merge');
  if (merges.length > 0 && merges.length < decisions.length) {
    return { kind: 'refused', why: `a merge mixed with other removals: ${decisions.map(decisionText).join(', ')}` };
  }
  if (merges.length > 0) {
    const targets = new Set(merges.map((d) => (d.into === null ? undefined : sidOfOrigin(d.into))));
    const [into] = targets;
    if (targets.size !== 1 || into === undefined) {
      return { kind: 'refused', why: `its merges reach no single SID in this build: ${merges.map((d) => `${decisionText(d)} into ${d.into ?? 'no record'}`).join(', ')}` };
    }
    return { kind: 'merged', decision: merges[0], into };
  }
  const park = decisions.find((d) => d.effect === 'park');
  return park === undefined ? { kind: 'retired', decision: decisions[0] } : { kind: 'parked', decision: park };
}

function groupBy<T>(items: Iterable<T>, keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

type Pending =
  | { readonly kind: 'resolved'; readonly survivor: LedgerRow; readonly losers: readonly LedgerRow[] }
  | { readonly kind: 'new'; readonly canonicalKey: string }
  | { readonly kind: 'reappeared'; readonly rows: readonly LedgerRow[] };

export function allocate(input: AllocateInput, upstream: Upstream): Allocation {
  const { objects, ledger, scope } = input;
  for (const obj of objects) for (const d of obj.designations) parseDesignation(d);
  const errors: string[] = [];

  const { classes: uf, kept, ambiguous, objectsByClass } = sameAsClasses(
    objects.map((o) => o.designations), input.storedEdges,
  );
  kept.forEach((ds, i) => { if (ds.length === 0) errors.push(`${objects[i].label}: no usable designation (keyless)`); });
  for (const row of ledger) uf.add(row.canonicalKey);

  const retired = retiredSids(input.events);
  const rowsByRoot = groupBy(ledger, (r) => uf.find(r.canonicalKey));
  const membersByRoot = groupBy(uf.nodes(), (n) => uf.find(n));
  const classText = (root: string): string => `{${membersByRoot.get(root)!.join(', ')}}`;

  const pendingByRoot = new Map<string, Pending>();
  for (const root of objectsByClass.keys()) {
    const rows = rowsByRoot.get(root) ?? [];
    const active = rows.filter((r) => !retired.has(r.sid));
    if (active.length > 0) {
      const survivor = mergeSurvivor(active);
      pendingByRoot.set(root, { kind: 'resolved', survivor, losers: active.filter((r) => r !== survivor) });
    } else if (rows.length === 0) {
      pendingByRoot.set(root, { kind: 'new', canonicalKey: canonicalKeyOf(membersByRoot.get(root)!) });
    } else {
      pendingByRoot.set(root, { kind: 'reappeared', rows });
    }
  }
  const firstObject = (root: string): SidObject => objects[objectsByClass.get(root)![0]];

  const orphans = ledger.filter((row) => !retired.has(row.sid)
    && !objectsByClass.has(uf.find(row.canonicalKey))
    && scope(parseDesignation(row.canonicalKey).ns));
  const losers = [...pendingByRoot.values()].flatMap((p) => (p.kind === 'resolved' ? p.losers : []));
  const causes = orphans.length + losers.length === 0
    ? new Map<string, Causes>()
    : upstream.causes([...orphans, ...losers].map((r) => r.canonicalKey));
  const causesOf = (key: string): Causes => causes.get(key) ?? { decisions: [], seenBy: [] };

  const admitted = [...pendingByRoot].flatMap(([root, p]) => {
    if (p.kind === 'resolved') return [];
    const { admission } = firstObject(root);
    return admission.kind === 'lineage' ? [admission.origin] : [];
  });
  const admissions = admitted.length === 0 ? new Map<string, string>() : upstream.admissions(admitted);

  let nextSid = ledger.reduce((max, r) => Math.max(max, r.sid), 0) + 1;
  const minted: LedgerRow[] = [];
  const outcomeByRoot = new Map<string, ObjectOutcome>();
  for (const [root, p] of pendingByRoot) {
    if (p.kind === 'resolved') {
      outcomeByRoot.set(root, { kind: 'resolved', sid: p.survivor.sid, via: p.survivor.canonicalKey });
      continue;
    }
    const obj = firstObject(root);
    const code = obj.admission.kind === 'declared' ? obj.admission.code : admissions.get(obj.admission.origin);
    if (code === undefined) {
      errors.push(`${obj.label} ${classText(root)}: no lineage stage records the decision that admitted it, so it cannot be ${p.kind === 'new' ? 'minted' : 'reinstated'}`);
    } else if (p.kind === 'new') {
      const row: LedgerRow = { sid: nextSid++, canonicalKey: p.canonicalKey, kind: obj.kind, firstSeen: input.date };
      minted.push(row);
      outcomeByRoot.set(root, { kind: 'minted', sid: row.sid, canonicalKey: row.canonicalKey, code });
    } else if (p.rows.length === 1) {
      outcomeByRoot.set(root, { kind: 'reinstated', sid: p.rows[0].sid, code });
    } else {
      errors.push(`${obj.label} ${classText(root)}: reaches ${p.rows.length} retired sids (${p.rows.map((r) => r.sid).join(', ')}), so which to reinstate is not one answer`);
    }
  }

  const kindBySid = new Map<number, SidKind>([...ledger, ...minted].map((r) => [r.sid, r.kind]));
  const sidByOrigin = new Map<string, number>();
  const objectOutcomes = objects.map((obj, i): ObjectOutcome | undefined => {
    const outcome = kept[i].length === 0 ? undefined : outcomeByRoot.get(uf.find(kept[i][0]));
    if (outcome === undefined) return undefined;
    if (kindBySid.get(outcome.sid) !== obj.kind) {
      errors.push(`${obj.label}: kind "${obj.kind}" conflicts with sid ${outcome.sid}'s ledger kind "${kindBySid.get(outcome.sid)}"`);
    }
    if (obj.admission.origin !== null) sidByOrigin.set(obj.admission.origin, outcome.sid);
    return outcome;
  });
  const sidOfOrigin = (origin: string): number | undefined => sidByOrigin.get(origin);

  const removals: SidRemoval[] = [];
  const settle = (row: LedgerRow, context: string): Settled => {
    const settled = settleRemoval(causesOf(row.canonicalKey), sidOfOrigin);
    if (settled.kind === 'refused') errors.push(`sid ${row.sid} (${row.canonicalKey}) ${context}: ${settled.why}`);
    return settled;
  };
  const losersByRoot = [...pendingByRoot].flatMap(([root, p]) => (
    p.kind === 'resolved' ? p.losers.map((loser) => ({ root, loser, survivor: p.survivor })) : []
  ));
  for (const { root, loser, survivor } of losersByRoot) {
    const settled = settle(loser, `shares class ${classText(root)} with sid ${survivor.sid}`);
    if (settled.kind === 'refused') continue;
    if (settled.kind !== 'merged' || settled.into !== survivor.sid) {
      errors.push(`sid ${loser.sid} (${loser.canonicalKey}) shares class ${classText(root)} with sid ${survivor.sid}, but ${decisionText(settled.decision)} does not merge it into ${survivor.sid}`);
      continue;
    }
    removals.push({ kind: 'merged', sid: loser.sid, canonicalKey: loser.canonicalKey, into: survivor.sid, decision: settled.decision });
  }
  const ambiguousCarriers = new Map(ambiguous.map((a) => [a.designation, a.objects.length]));
  for (const row of orphans) {
    const carriers = ambiguousCarriers.get(row.canonicalKey);
    if (carriers !== undefined) {
      errors.push(`sid ${row.sid} (${row.canonicalKey}) left the build: ${carriers} objects now carry its key, so it names none of them; a bridge in sameas-overrides.tsv to the one it was must say which`);
      continue;
    }
    const settled = settle(row, 'left the build');
    if (settled.kind === 'refused') continue;
    const base = { sid: row.sid, canonicalKey: row.canonicalKey, decision: settled.decision };
    removals.push(settled.kind === 'merged' ? { ...base, kind: 'merged', into: settled.into } : { ...base, kind: settled.kind });
  }

  if (errors.length > 0) return { kind: 'failed', errors, ambiguous };
  const outcomes = objectOutcomes.map((o, i) => {
    if (o === undefined) throw new Error(`${objects[i].label}: no outcome and no error recorded for it`);
    return o;
  });

  const event = (sid: number, kind: EventRow['event'], code: string, origin: string | null, successor: number | null = null): EventRow => ({
    sid, date: input.date, event: kind, code,
    params: origin === null ? '' : JSON.stringify({ key: origin }),
    successor, buildVersion: input.version,
  });
  const removalOrder = new Map(ledger.map((r, i) => [r.sid, i]));
  const events: EventRow[] = [...removals]
    .sort((a, b) => removalOrder.get(a.sid)! - removalOrder.get(b.sid)!)
    .flatMap((r) => {
      if (r.kind === 'merged') return [event(r.sid, 'merge', r.decision.code, r.decision.origin, r.into)];
      if (r.kind === 'retired') return [event(r.sid, 'retire', r.decision.code, r.decision.origin)];
      return [];
    });
  const announced = new Set<number>();
  outcomes.forEach((o, i) => {
    if (o.kind === 'resolved' || announced.has(o.sid)) return;
    announced.add(o.sid);
    events.push(event(o.sid, o.kind === 'minted' ? 'mint' : 'reinstate', o.code, objects[i].admission.origin));
  });

  return { kind: 'allocated', outcomes, removals, minted, events, ambiguous };
}
