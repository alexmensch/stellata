import { describe, expect, it } from 'vitest';

import {
  allocate, mergeSurvivor, settleRemoval,
  type Allocation, type AllocateInput, type Causes, type Decision, type SidObject, type Upstream,
} from './allocate-pure';
import type { EventRow } from './events-pure';
import { starDesignations, type LedgerRow } from './sid-pure';

const date = '2026-11-01';
const version = '7.1.8';
const STAR_NS = new Set(['sol', 'hip', 'hd', 'hr', 'gl', 'gaia_dr3', 'synth']);
const STARS = (ns: string): boolean => STAR_NS.has(ns);
const ALL = (): boolean => true;

const ev = (sid: number, event: EventRow['event'], successor: number | null = null): EventRow => (
  { sid, date: '2026-07-09', event, code: 'c', params: '', successor, buildVersion: '7.1.6' }
);
const row = (sid: number, canonicalKey: string, kind: LedgerRow['kind'] = 'star'): LedgerRow => (
  { sid, canonicalKey, kind, firstSeen: '2026-07-01' }
);
const star = (origin: string, ...designations: string[]): SidObject => (
  { designations, kind: 'star', label: origin, admission: { kind: 'lineage', origin } }
);
const decision = (origin: string, code: string, effect: Decision['effect'], into: string | null = null): Decision => (
  { stage: code.split('.')[0], origin, code, effect, into }
);

function upstream(causes: Record<string, Causes> = {}, admissions: Record<string, string> = {}): Upstream & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    causes: (keys) => { asked.push([...keys]); return new Map(keys.flatMap((k) => (causes[k] ? [[k, causes[k]]] : []))); },
    admissions: (origins) => new Map(origins.flatMap((o) => (admissions[o] ? [[o, admissions[o]]] : []))),
  };
}

const ADMIT = 'membership.admit.spine';

function run(input: Partial<AllocateInput> & Pick<AllocateInput, 'objects'>, up: Upstream = upstream()): Allocation {
  return allocate({ storedEdges: [], ledger: [], events: [], scope: STARS, date, version, ...input }, up);
}

function allocated(a: Allocation): Extract<Allocation, { kind: 'allocated' }> {
  if (a.kind === 'failed') throw new Error(a.errors.join('\n'));
  return a;
}

function failed(a: Allocation): readonly string[] {
  if (a.kind !== 'failed') throw new Error('allocation succeeded');
  return a.errors;
}

describe('allocate: resolution and minting', () => {
  const objects: SidObject[] = [
    star('spine:1', 'sol:sun', 'hd:1'),
    star('spine:2', 'hip:32349', 'hd:48915', 'gaia_dr3:9'),
    star('magnitude:5', 'gaia_dr3:594599568167552'),
    star('multiples:04357+1010/Aa,Ab', 'synth:04357+1010-Aa,Ab'),
    { designations: ['cloud:orion-a'], kind: 'cloud', label: 'cloud orion-a', admission: { kind: 'declared', code: 'allocation.mint.cloud', origin: null } },
    { designations: ['sol:pluto'], kind: 'planet', label: 'sol pluto', admission: { kind: 'declared', code: 'allocation.mint.sol-list', origin: 'sol-objects:pluto' } },
  ];
  const admissions = Object.fromEntries(objects.flatMap((o) => (o.admission.kind === 'lineage' ? [[o.admission.origin, ADMIT]] : [])));

  it('mints in object order with ladder canonical keys, each event coded by the admitting decision', () => {
    const a = allocated(run({ objects, scope: ALL }, upstream({}, admissions)));
    expect(a.minted.map((m) => [m.sid, m.canonicalKey, m.kind, m.firstSeen])).toEqual([
      [1, 'sol:sun', 'star', date],
      [2, 'hip:32349', 'star', date],
      [3, 'gaia_dr3:594599568167552', 'star', date],
      [4, 'synth:04357+1010-Aa,Ab', 'star', date],
      [5, 'cloud:orion-a', 'cloud', date],
      [6, 'sol:pluto', 'planet', date],
    ]);
    expect(a.outcomes.map((o) => o.sid)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(a.events.map((e) => [e.sid, e.event, e.code, e.params, e.buildVersion])).toEqual([
      [1, 'mint', ADMIT, '{"key":"spine:1"}', version],
      [2, 'mint', ADMIT, '{"key":"spine:2"}', version],
      [3, 'mint', ADMIT, '{"key":"magnitude:5"}', version],
      [4, 'mint', ADMIT, '{"key":"multiples:04357+1010/Aa,Ab"}', version],
      [5, 'mint', 'allocation.mint.cloud', '', version],
      [6, 'mint', 'allocation.mint.sol-list', '{"key":"sol-objects:pluto"}', version],
    ]);
  });

  it('an unchanged tree with no orphan allocates with zero events and asks the lineage nothing', () => {
    const first = allocated(run({ objects, scope: ALL }, upstream({}, admissions)));
    const up = upstream();
    const second = allocated(run({ objects, scope: ALL, ledger: [...first.minted] }, up));
    expect(second.minted).toEqual([]);
    expect(second.events).toEqual([]);
    expect(second.outcomes.map((o) => o.sid)).toEqual(first.outcomes.map((o) => o.sid));
    expect(second.outcomes.every((o) => o.kind === 'resolved')).toBe(true);
    expect(up.asked).toEqual([]);
  });

  it('refuses to mint an object no stage admits, naming it', () => {
    expect(failed(run({ objects: [star('spine:9', 'hip:9')] }))).toEqual([
      'spine:9 {hip:9}: no lineage stage records the decision that admitted it, so it cannot be minted',
    ]);
  });

  it('never re-keys: a later-acquired stronger designation joins the class', () => {
    const a = allocated(run({
      objects: [star('spine:1', 'hip:7', 'gaia_dr3:594599568167552')],
      ledger: [row(1, 'gaia_dr3:594599568167552')],
    }));
    expect(a.outcomes.map((o) => o.sid)).toEqual([1]);
    expect(a.outcomes).toEqual([{ kind: 'resolved', sid: 1, via: 'gaia_dr3:594599568167552' }]);
  });

  // A HIP-less record whose overlay cell holds a LOWER second HD than the one it
  // displays: the alternative sorts ahead of the stored key, so recomputing the
  // key would re-key it; reading the ledger keeps the sid.
  it('a lower alternative HD joins the class without moving the stored key', () => {
    const designations = starDesignations({
      isSol: false, hip: null, hd: 281098, hr: null, hdAlt: [35908], hrAlt: [],
      gl: null, gaiaSourceId: null, syntheticId: null,
    });
    const a = allocated(run({ objects: [star('spine:1', ...designations)], ledger: [row(1, 'hd:281098')] }));
    expect(a.outcomes.map((o) => o.sid)).toEqual([1]);
  });

  it('a stored edge resolves a re-lettered synth key to its frozen sid', () => {
    const a = allocated(run({
      objects: [star('multiples:04357+1010/Aa1,2', 'synth:04357+1010-Aa1,2')],
      storedEdges: [{ a: 'synth:04357+1010-Aa,Ab', b: 'synth:04357+1010-Aa1,2' }],
      ledger: [row(1, 'synth:04357+1010-Aa,Ab')],
    }));
    expect(a.outcomes.map((o) => o.sid)).toEqual([1]);
  });

  it('a stored edge puts two objects in one class, under one SID', () => {
    const a = allocated(run({
      objects: [star('spine:1', 'hip:1'), star('magnitude:5', 'gaia_dr3:5')],
      storedEdges: [{ a: 'hip:1', b: 'gaia_dr3:5' }],
    }, upstream({}, { 'spine:1': ADMIT, 'magnitude:5': ADMIT })));
    expect(a.minted.map((m) => m.canonicalKey)).toEqual(['hip:1']);
    expect(a.outcomes.map((o) => o.sid)).toEqual([1, 1]);
  });

  it('errors on a kind conflict with the frozen ledger row', () => {
    const a = run({
      objects: [{ designations: ['cloud:orion-a'], kind: 'galaxy', label: 'lg orion-a', admission: { kind: 'declared', code: 'allocation.mint.local-group', origin: null } }],
      ledger: [row(1, 'cloud:orion-a', 'cloud')],
      scope: ALL,
    });
    expect(failed(a)[0]).toMatch(/kind "galaxy" conflicts/);
  });

  it('errors on a keyless object', () => {
    expect(failed(run({ objects: [star('spine:1', 'hd:1'), star('spine:2', 'hd:1')] }))).toEqual([
      'spine:1: no usable designation (keyless)', 'spine:2: no usable designation (keyless)',
    ]);
  });
});

describe('allocate: SIDs that leave the build', () => {
  const ledger = [row(1, 'hip:1'), row(2, 'gaia_dr3:2')];
  const live = [star('spine:1', 'hip:1')];

  it('a coded removal writes exactly one retire event carrying its code and upstream decision', () => {
    const up = upstream({ 'gaia_dr3:2': { decisions: [decision('multiples:X/B', 'promotion.dropped.no-absmag', 'retire')], seenBy: ['promotion'] } });
    const a = allocated(run({ objects: live, ledger }, up));
    expect(a.events).toEqual([{
      sid: 2, date, event: 'retire', code: 'promotion.dropped.no-absmag',
      params: '{"key":"multiples:X/B"}', successor: null, buildVersion: version,
    }]);
    expect(up.asked).toEqual([['gaia_dr3:2']]);
  });

  it('a park writes no event: the SID stays live, absent from this build, and is asked about on every run', () => {
    const up = upstream({
      'gaia_dr3:2': { decisions: [decision('spine:7', 'placement.park.no-position', 'park')], seenBy: ['membership'] },
    });
    const a = allocated(run({ objects: live, ledger }, up));
    expect(a.events).toEqual([]);
    expect(a.removals.map((r) => r.kind)).toEqual(['parked']);
    expect(up.asked).toEqual([['gaia_dr3:2']]);
  });

  it('a park beats a retire on the same SID', () => {
    const a = allocated(run({ objects: live, ledger }, upstream({
      'gaia_dr3:2': {
        decisions: [
          decision('multiples:X/Ba', 'promotion.parked.primary-unresolved', 'park'),
          decision('multiples:X/Bb', 'promotion.dropped.no-absmag', 'retire'),
        ],
        seenBy: ['promotion'],
      },
    })));
    expect(a.events).toEqual([]);
    expect(a.removals).toMatchObject([{ kind: 'parked', sid: 2, decision: { code: 'promotion.parked.primary-unresolved' } }]);
  });

  it('a merge writes a merge event naming the SID its target record carries', () => {
    const a = allocated(run({ objects: live, ledger }, upstream({
      'gaia_dr3:2': { decisions: [decision('spine:9', 'membership.fold', 'merge', 'spine:1')], seenBy: ['membership'] },
    })));
    expect(a.events.map((e) => [e.sid, e.event, e.code, e.successor])).toEqual([[2, 'merge', 'membership.fold', 1]]);
  });

  it('fails closed on an orphan no decision explains, naming the stage that holds its record', () => {
    expect(failed(run({ objects: live, ledger }, upstream({ 'gaia_dr3:2': { decisions: [], seenBy: ['promotion'] } })))).toEqual([
      'sid 2 (gaia_dr3:2) left the build: promotion holds its record with no retire, park or merge decision',
    ]);
    expect(failed(run({ objects: live, ledger }))).toEqual([
      'sid 2 (gaia_dr3:2) left the build: no lineage stage holds a record carrying it',
    ]);
  });

  it('fails closed on a merge mixed with another removal', () => {
    const errors = failed(run({ objects: live, ledger }, upstream({
      'gaia_dr3:2': { decisions: [decision('spine:9', 'membership.fold', 'merge', 'spine:1'), decision('spine:9', 'placement.park.no-position', 'park')], seenBy: ['membership'] },
    })));
    expect(errors[0]).toMatch(/a merge mixed with other removals/);
  });

  it('fails closed on a merge whose target carries no SID in this build', () => {
    const errors = failed(run({ objects: live, ledger }, upstream({
      'gaia_dr3:2': { decisions: [decision('spine:9', 'membership.fold', 'merge', 'spine:404')], seenBy: ['membership'] },
    })));
    expect(errors[0]).toMatch(/reach no single SID/);
  });

  it('names the ambiguity when an orphan\'s key is now carried by two objects', () => {
    const errors = failed(run({
      objects: [star('spine:1', 'hip:1', 'hd:9'), star('spine:3', 'hip:3', 'hd:9')],
      ledger: [row(1, 'hip:1'), row(2, 'hd:9'), row(3, 'hip:3')],
    }));
    expect(errors).toEqual([
      'sid 2 (hd:9) left the build: 2 objects now carry its key, so it names none of them; a bridge in sameas-overrides.tsv to the one it was must say which',
    ]);
  });

  it('only a SID keyed in the caller\'s scope can leave its build', () => {
    const a = allocated(run({ objects: live, ledger: [...ledger, row(3, 'cloud:gone', 'cloud')] }, upstream({
      'gaia_dr3:2': { decisions: [decision('spine:7', 'placement.park.no-position', 'park')], seenBy: ['membership'] },
    })));
    expect(a.removals.map((r) => r.sid)).toEqual([2]);
  });

  it('a retired SID is not asked about again', () => {
    const up = upstream();
    allocated(run({ objects: live, ledger, events: [ev(2, 'retire')] }, up));
    expect(up.asked).toEqual([]);
  });
});

describe('allocate: two active SIDs in one class', () => {
  const ledger = [row(1, 'hip:1'), row(2, 'gaia_dr3:2')];
  const objects = [star('spine:1', 'hip:1', 'gaia_dr3:2')];

  it('merges the loser into the survivor when its decision says so', () => {
    const a = allocated(run({ objects, ledger }, upstream({
      'gaia_dr3:2': { decisions: [decision('magnitude:2', 'membership.fold', 'merge', 'spine:1')], seenBy: ['membership'] },
    })));
    expect(a.outcomes.map((o) => o.sid)).toEqual([1]);
    expect(a.events.map((e) => [e.sid, e.event, e.successor])).toEqual([[2, 'merge', 1]]);
  });

  it('fails closed when the loser has no merge decision', () => {
    expect(failed(run({ objects, ledger }))[0]).toBe(
      'sid 2 (gaia_dr3:2) shares class {hip:1, gaia_dr3:2} with sid 1: no lineage stage holds a record carrying it',
    );
  });

  it('a recorded merge event resolves to the survivor with no new event', () => {
    const a = allocated(run({ objects, ledger, events: [ev(2, 'merge', 1)] }));
    expect(a.outcomes.map((o) => o.sid)).toEqual([1]);
    expect(a.events).toEqual([]);
  });
});

describe('allocate: a retired class reappears', () => {
  const ledger = [row(1, 'hip:1')];

  it('reinstates the original SID under the code of the decision that admitted it', () => {
    const a = allocated(run({ objects: [star('spine:1', 'hip:1')], ledger, events: [ev(1, 'retire')] }, upstream({}, { 'spine:1': ADMIT })));
    expect(a.outcomes.map((o) => o.sid)).toEqual([1]);
    expect(a.minted).toEqual([]);
    expect(a.events.map((e) => [e.sid, e.event, e.code])).toEqual([[1, 'reinstate', ADMIT]]);
  });

  it('fails closed with no admitting decision', () => {
    expect(failed(run({ objects: [star('spine:1', 'hip:1')], ledger, events: [ev(1, 'retire')] }))[0]).toMatch(/cannot be reinstated/);
  });

  it('a reinstated SID resolves with no new event', () => {
    const a = allocated(run({ objects: [star('spine:1', 'hip:1')], ledger, events: [ev(1, 'retire'), ev(1, 'reinstate')] }));
    expect(a.events).toEqual([]);
  });
});

describe('settleRemoval', () => {
  const none = (): undefined => undefined;
  it('takes the first retire when every decision retires', () => {
    const settled = settleRemoval({
      decisions: [decision('a', 'promotion.dropped.no-absmag', 'retire'), decision('b', 'promotion.dropped.no-position', 'retire')],
      seenBy: ['promotion'],
    }, none);
    expect(settled).toMatchObject({ kind: 'retired', decision: { origin: 'a' } });
  });
});

describe('mergeSurvivor', () => {
  it('keeps the classical key over a lower Gaia SID, else the oldest', () => {
    expect(mergeSurvivor([row(5, 'gaia_dr3:1'), row(9, 'hd:2')]).sid).toBe(9);
    expect(mergeSurvivor([row(9, 'hd:2'), row(7, 'hip:3')]).sid).toBe(7);
    expect(mergeSurvivor([row(9, 'gaia_dr3:1'), row(4, 'synth:x')]).sid).toBe(4);
  });
});
