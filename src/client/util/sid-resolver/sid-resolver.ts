// Runtime SID resolver: global sid → {kind, localIndex} lookup over
// whichever object-carrying artifacts attach, plus deferred intents for
// late-attaching domains. See README.md and docs/sid.md § 8.

export type SidRuntimeKind = 'star' | 'planet' | 'cloud' | 'lg' | 'shell' | 'probe';

export interface SidDomain {
  /** sid → this domain's local index, or null when it doesn't carry it. */
  localIndexOf(sid: number): number | null;
  /** local index → sid, or null when the object carries none. */
  sidOf(localIndex: number): number | null;
}

export type SidResolution =
  | { status: 'resolved'; kind: SidRuntimeKind; localIndex: number }
  | { status: 'pending' }
  | { status: 'unknown' };

interface DeferredIntent {
  sid: number;
  apply: (kind: SidRuntimeKind, localIndex: number) => void;
}

export class SidResolver {
  private readonly roster: readonly SidRuntimeKind[];
  private readonly domains = new Map<SidRuntimeKind, SidDomain | 'absent'>();
  private readonly successors: ReadonlyMap<number, number>;
  private intents: DeferredIntent[] = [];

  /** `roster` declares every domain this client may attach; a sid stays
   *  `pending` while any of them is neither attached nor concluded.
   *  `successors` is the retired-sid → successor-sid map (docs/sid.md
   *  § 9.4) — resolution follows it before consulting the domains. */
  constructor(
    roster: readonly SidRuntimeKind[],
    successors: ReadonlyMap<number, number> = new Map(),
  ) {
    this.roster = roster;
    this.successors = successors;
  }

  /** Wire a domain when its artifact attaches. Replaces a previous
   *  attach (or an earlier conclude) and flushes matching intents. */
  attach(kind: SidRuntimeKind, domain: SidDomain): void {
    this.assertRegistered(kind);
    this.domains.set(kind, domain);
    this.flushIntents();
  }

  /** Mark a domain as never-attaching (missing artifact, shelved layer)
   *  so pending resolutions can settle to `unknown`. No-op when the
   *  domain already attached. */
  conclude(kind: SidRuntimeKind): void {
    this.assertRegistered(kind);
    if (this.domains.get(kind) !== undefined) return;
    this.domains.set(kind, 'absent');
    this.flushIntents();
  }

  resolve(sid: number): SidResolution {
    if (!Number.isInteger(sid) || sid <= 0) return { status: 'unknown' };
    const canonical = this.followSuccessors(sid);
    if (canonical === null) return { status: 'unknown' };
    return this.resolveCanonical(canonical);
  }

  /** Chase the retired → successor chain to its live end. A retired sid
   *  never appears in any artifact (ledger ⟷ build consistency is
   *  CI-guarded), so canonicalising before the domain walk is lossless.
   *  Returns null on a corrupt cycle. */
  private followSuccessors(sid: number): number | null {
    let cur = sid;
    let hops = 0;
    for (;;) {
      const next = this.successors.get(cur);
      if (next === undefined) return cur;
      if (++hops > this.successors.size) return null;
      cur = next;
    }
  }

  private resolveCanonical(sid: number): SidResolution {
    let undetermined = false;
    for (const kind of this.roster) {
      const d = this.domains.get(kind);
      if (d === undefined) {
        undetermined = true;
      } else if (d !== 'absent') {
        const localIndex = d.localIndexOf(sid);
        if (localIndex !== null) return { status: 'resolved', kind, localIndex };
      }
    }
    return undetermined ? { status: 'pending' } : { status: 'unknown' };
  }

  /** Reverse lookup for encoders; null while the domain isn't attached. */
  sidOf(kind: SidRuntimeKind, localIndex: number): number | null {
    const d = this.domains.get(kind);
    return d === undefined || d === 'absent' ? null : d.sidOf(localIndex);
  }

  /** Apply now if the sid resolves, queue as a deferred intent while
   *  it's pending, drop silently when unknown. Queued intents fire on
   *  the attach that claims them and expire once every registered
   *  domain has settled without one claiming. */
  whenResolved(sid: number, apply: (kind: SidRuntimeKind, localIndex: number) => void): void {
    const r = this.resolve(sid);
    if (r.status === 'resolved') apply(r.kind, r.localIndex);
    else if (r.status === 'pending') this.intents.push({ sid, apply });
  }

  private flushIntents(): void {
    if (this.intents.length === 0) return;
    const kept: DeferredIntent[] = [];
    for (const intent of this.intents) {
      const r = this.resolve(intent.sid);
      if (r.status === 'resolved') intent.apply(r.kind, r.localIndex);
      else if (r.status === 'pending') kept.push(intent);
    }
    this.intents = kept;
  }

  private assertRegistered(kind: SidRuntimeKind): void {
    if (!this.roster.includes(kind)) {
      throw new Error(`SID domain '${kind}' is not in this resolver's roster`);
    }
  }
}

/** Domain over an artifact's in-record sid column, keyed by array
 *  position. sid 0 (NO_SID) is unclaimable in both directions. */
export function arrayDomain(sids: ArrayLike<number>): SidDomain {
  const bySid = new Map<number, number>();
  for (let i = 0; i < sids.length; i++) {
    const s = sids[i];
    if (s > 0 && !bySid.has(s)) bySid.set(s, i);
  }
  return {
    localIndexOf: (sid) => bySid.get(sid) ?? null,
    sidOf: (i) => (i >= 0 && i < sids.length && sids[i] > 0 ? sids[i] : null),
  };
}

/** Validates an artifact's sid column at parse time: every entry a
 *  positive integer, no duplicates. Returns null when valid, else a
 *  description for the loader's warn-and-reject path. */
export function sidColumnError(sids: readonly unknown[]): string | null {
  const seen = new Set<number>();
  for (let i = 0; i < sids.length; i++) {
    const s = sids[i];
    if (typeof s !== 'number' || !Number.isInteger(s) || s <= 0) {
      return `record ${i} has a missing or invalid sid`;
    }
    if (seen.has(s)) return `duplicate sid ${s} at record ${i}`;
    seen.add(s);
  }
  return null;
}
