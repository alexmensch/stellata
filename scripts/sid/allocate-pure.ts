// SID allocation: every object resolved, minted or reinstated against the ledger, every SID no object reaches joined to the upstream decision that removed it, and the events that follow. See /docs/sid.md#44-allocation.

import type { EventRow } from './events-pure';
import { retiredSids } from './events-pure';
import {
  canonicalKeyOf, parseDesignation, sameAsClasses,
  type AmbiguousDesignation, type LedgerRow, type SameasEdge, type SidKind,
} from './sid-pure';

export interface SidObject {
  designations: string[];
  kind: SidKind;
  label: string;
  /** The origin key lineage files the object under; null for an object no lineage stage records. */
  origin: string | null;
}

export type RemovalEffect = 'retire' | 'park' | 'merge';

export interface Decision {
  readonly stage: string;
  readonly origin: string;
  readonly code: string;
  readonly effect: RemovalEffect;
  /** For a merge: the origin key of the record it merges into. */
  readonly into: string | null;
}

/** Why a ledger SID's record is gone, from the lineage of the record that carried its key. */
export type Cause =
  | { readonly kind: 'decided'; readonly decision: Decision }
  | { readonly kind: 'undecided'; readonly seenBy: readonly string[] }
  | { readonly kind: 'conflicting'; readonly decisions: readonly Decision[] };

export interface AllocateInput {
  readonly objects: readonly SidObject[];
  readonly storedEdges: readonly SameasEdge[];
  readonly ledger: readonly LedgerRow[];
  readonly events: readonly EventRow[];
  /** The ledger namespaces this caller allocates: only a SID keyed in one of them can be orphaned here. */
  readonly scope: ReadonlySet<string>;
  causeOf(canonicalKey: string): Cause;
  /** The code of the decision that admitted the object, or null when no lineage stage records one. */
  admissionOf(object: number): string | null;
  readonly date: string;
  readonly version: string;
}

export type ObjectOutcome =
  | { readonly kind: 'resolved'; readonly sid: number; readonly via: string }
  | { readonly kind: 'minted'; readonly sid: number; readonly canonicalKey: string; readonly route: string }
  | { readonly kind: 'reinstated'; readonly sid: number; readonly route: string }
  | { readonly kind: 'unresolved' };

export type SidRemoval =
  | { readonly kind: 'merged'; readonly sid: number; readonly canonicalKey: string; readonly into: number; readonly decision: Decision }
  | { readonly kind: 'retired'; readonly sid: number; readonly canonicalKey: string; readonly decision: Decision }
  | { readonly kind: 'parked'; readonly sid: number; readonly canonicalKey: string; readonly decision: Decision };

export interface AllocateResult {
  readonly errors: string[];
  readonly keyless: number[];
  readonly ambiguous: AmbiguousDesignation[];
  readonly outcomes: ObjectOutcome[];
  /** Per object: its SID, 0 where its outcome is unresolved. */
  readonly objectSids: number[];
  readonly removals: SidRemoval[];
  readonly minted: LedgerRow[];
  /** The events this allocation appends, in ledger-then-object order. */
  readonly events: EventRow[];
  /** Classes covering more than one object (stored-edge merges). */
  readonly mergedClasses: { sid: number; objects: number[] }[];
}

const CLASSICAL = new Set(['sol', 'hip', 'hd', 'hr', 'gl']);

/** /docs/sid.md#43-ledger--datasidledgertsv: the classical key the merged record keys on survives;
 *  with none, the oldest SID. */
export function mergeSurvivor(active: readonly LedgerRow[]): LedgerRow {
  const key = canonicalKeyOf(active.map((r) => r.canonicalKey));
  const named = active.find((r) => r.canonicalKey === key);
  if (named !== undefined && CLASSICAL.has(parseDesignation(key).ns)) return named;
  return active.reduce((a, b) => (b.sid < a.sid ? b : a));
}

function causeText(cause: Cause): string {
  switch (cause.kind) {
    case 'decided': return `${cause.decision.code} on ${cause.decision.origin}`;
    case 'undecided': return cause.seenBy.length === 0
      ? 'no lineage stage records its record'
      : `${cause.seenBy.join(', ')} keep${cause.seenBy.length === 1 ? 's' : ''} its record with no removal decision`;
    case 'conflicting': return `conflicting decisions ${cause.decisions.map((d) => `${d.code} on ${d.origin}`).join(', ')}`;
  }
}

export function allocate(input: AllocateInput): AllocateResult {
  const { objects, ledger, scope } = input;
  const errors: string[] = [];
  for (const obj of objects) for (const d of obj.designations) parseDesignation(d);

  const { classes: uf, kept, ambiguous, objectsByClass } = sameAsClasses(
    objects.map((o) => o.designations), input.storedEdges,
  );
  const keyless = kept.flatMap((ds, i) => (ds.length === 0 ? [i] : []));
  for (const i of keyless) errors.push(`${objects[i].label}: no usable designation (keyless)`);
  for (const row of ledger) uf.add(row.canonicalKey);

  const retired = retiredSids(input.events);
  const rowsByRoot = new Map<string, LedgerRow[]>();
  for (const row of ledger) {
    const root = uf.find(row.canonicalKey);
    const list = rowsByRoot.get(root);
    if (list) list.push(row);
    else rowsByRoot.set(root, [row]);
  }
  const membersByRoot = new Map<string, string[]>();
  for (const node of uf.nodes()) {
    const root = uf.find(node);
    const list = membersByRoot.get(root);
    if (list) list.push(node);
    else membersByRoot.set(root, [node]);
  }
  const classText = (root: string): string => `{${membersByRoot.get(root)!.join(', ')}}`;

  const removals: SidRemoval[] = [];
  const sidByRoot = new Map<string, { sid: number; outcome: ObjectOutcome }>();
  const pendingMerges: { root: string; loser: LedgerRow; into: number }[] = [];
  const kindBySid = new Map<number, SidKind>(ledger.map((r) => [r.sid, r.kind]));
  const minted: LedgerRow[] = [];
  let nextSid = ledger.reduce((max, r) => Math.max(max, r.sid), 0) + 1;

  const outcomes: ObjectOutcome[] = objects.map((obj, i) => {
    if (kept[i].length === 0) return { kind: 'unresolved' };
    const root = uf.find(kept[i][0]);
    const settled = sidByRoot.get(root);
    if (settled !== undefined) return settled.outcome;
    const rows = rowsByRoot.get(root) ?? [];
    const active = rows.filter((r) => !retired.has(r.sid));
    let outcome: ObjectOutcome;
    if (active.length >= 1) {
      const survivor = mergeSurvivor(active);
      for (const loser of active) if (loser !== survivor) pendingMerges.push({ root, loser, into: survivor.sid });
      outcome = { kind: 'resolved', sid: survivor.sid, via: survivor.canonicalKey };
    } else {
      const route = input.admissionOf(i);
      if (route === null) {
        errors.push(`${obj.label} ${classText(root)}: no lineage stage records the decision that admitted it, so it cannot be ${rows.length === 0 ? 'minted' : 'reinstated'}`);
        outcome = { kind: 'unresolved' };
      } else if (rows.length === 0) {
        const sid = nextSid++;
        minted.push({ sid, canonicalKey: canonicalKeyOf(membersByRoot.get(root)!), kind: obj.kind, firstSeen: input.date });
        kindBySid.set(sid, obj.kind);
        outcome = { kind: 'minted', sid, canonicalKey: minted[minted.length - 1].canonicalKey, route };
      } else if (rows.length === 1) {
        outcome = { kind: 'reinstated', sid: rows[0].sid, route };
      } else {
        errors.push(`${obj.label} ${classText(root)}: reaches ${rows.length} retired sids (${rows.map((r) => r.sid).join(', ')}), so which to reinstate is not one answer`);
        outcome = { kind: 'unresolved' };
      }
    }
    if (outcome.kind !== 'unresolved') sidByRoot.set(root, { sid: outcome.sid, outcome });
    return outcome;
  });

  const unresolve = (root: string, why: string): void => {
    errors.push(why);
    sidByRoot.set(root, { sid: 0, outcome: { kind: 'unresolved' } });
  };
  for (const { root, loser, into } of pendingMerges) {
    const cause = input.causeOf(loser.canonicalKey);
    if (cause.kind === 'decided' && cause.decision.effect === 'merge') {
      removals.push({ kind: 'merged', sid: loser.sid, canonicalKey: loser.canonicalKey, into, decision: cause.decision });
    } else {
      unresolve(root, `class ${classText(root)} reaches sids ${loser.sid} and ${into}, but sid ${loser.sid} (${loser.canonicalKey}) has no merge decision: ${causeText(cause)}`);
    }
  }

  const objectSids = outcomes.map((o, i) => {
    if (o.kind === 'unresolved' || kept[i].length === 0) return 0;
    return sidByRoot.get(uf.find(kept[i][0]))!.sid;
  });
  outcomes.forEach((o, i) => {
    if (o.kind !== 'unresolved' && objectSids[i] === 0) outcomes[i] = { kind: 'unresolved' };
  });
  objects.forEach((obj, i) => {
    const sid = objectSids[i];
    if (sid !== 0 && kindBySid.get(sid) !== obj.kind) {
      errors.push(`${obj.label}: kind "${obj.kind}" conflicts with sid ${sid}'s ledger kind "${kindBySid.get(sid)}"`);
    }
  });

  const sidByOrigin = new Map<string, number>();
  objects.forEach((obj, i) => { if (obj.origin !== null && objectSids[i] !== 0) sidByOrigin.set(obj.origin, objectSids[i]); });
  for (const row of ledger) {
    if (retired.has(row.sid) || objectsByClass.has(uf.find(row.canonicalKey))) continue;
    if (!scope.has(parseDesignation(row.canonicalKey).ns)) continue;
    const cause = input.causeOf(row.canonicalKey);
    if (cause.kind !== 'decided') {
      errors.push(`sid ${row.sid} (${row.canonicalKey}) left the build: ${causeText(cause)}`);
      continue;
    }
    const { decision } = cause;
    const base = { sid: row.sid, canonicalKey: row.canonicalKey, decision };
    if (decision.effect === 'park') removals.push({ kind: 'parked', ...base });
    else if (decision.effect === 'retire') removals.push({ kind: 'retired', ...base });
    else {
      const into = decision.into === null ? undefined : sidByOrigin.get(decision.into);
      if (into === undefined) {
        errors.push(`sid ${row.sid} (${row.canonicalKey}) merges by ${decision.code} on ${decision.origin}, but ${decision.into ?? 'no record'} it merges into carries no sid in this build`);
      } else {
        removals.push({ kind: 'merged', ...base, into });
      }
    }
  }

  const event = (sid: number, kind: EventRow['event'], code: string, origin: string | null, successor: number | null = null): EventRow => ({
    sid, date: input.date, event: kind, code,
    params: origin === null ? '' : JSON.stringify({ key: origin }),
    successor, buildVersion: input.version,
  });
  const events: EventRow[] = [];
  for (const r of removals) {
    if (r.kind === 'merged') events.push(event(r.sid, 'merge', r.decision.code, r.decision.origin, r.into));
    else if (r.kind === 'retired') events.push(event(r.sid, 'retire', r.decision.code, r.decision.origin));
  }
  const seen = new Set<number>();
  outcomes.forEach((o, i) => {
    if ((o.kind !== 'minted' && o.kind !== 'reinstated') || seen.has(o.sid)) return;
    seen.add(o.sid);
    events.push(event(o.sid, o.kind === 'minted' ? 'mint' : 'reinstate', o.route, objects[i].origin));
  });

  const mergedClasses: { sid: number; objects: number[] }[] = [];
  for (const [root, indices] of objectsByClass) {
    if (indices.length > 1) mergedClasses.push({ sid: sidByRoot.get(root)?.sid ?? 0, objects: indices });
  }

  return { errors, keyless, ambiguous, outcomes, objectSids, removals, minted, events, mergedClasses };
}
