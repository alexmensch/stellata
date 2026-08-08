// Contract pins for the kind-module roster: coverage and order, record
// exhaustiveness, and the two shell-side collectors (pick surfaces and
// declutter pushes).

import { describe, expect, it } from 'vitest';
import { KIND_TRAITS, type TargetKind } from '../camera/focus/focus-target';
import type { ObjectKindModule } from './kind-module';
import {
  buildKindModules,
  collectKindPicks,
  displayNameOf,
  KIND_ROSTER,
  mergeKindDetailBinds,
  type KindModules,
} from './kind-modules';

describe('KIND_ROSTER', () => {
  it('covers every TargetKind exactly once', () => {
    const kinds = Object.keys(KIND_TRAITS).sort();
    expect([...KIND_ROSTER].sort()).toEqual(kinds);
    expect(new Set(KIND_ROSTER).size).toBe(KIND_ROSTER.length);
  });

  it('leads with probe — its field must update before the planet layer', () => {
    expect(KIND_ROSTER[0]).toBe('probe');
    expect(KIND_ROSTER.indexOf('probe')).toBeLessThan(KIND_ROSTER.indexOf('planet'));
  });
});

describe('buildKindModules', () => {
  it('has an entry per TargetKind, with kind tags matching keys', () => {
    const modules = buildKindModules();
    for (const kind of Object.keys(KIND_TRAITS) as TargetKind[]) {
      const m = modules[kind];
      if (m !== null) expect(m.kind).toBe(kind);
    }
  });

  it('supplies the probe module', () => {
    expect(buildKindModules().probe.kind).toBe('probe');
  });
});

describe('KindModules exhaustiveness', () => {
  it('rejects a record missing a kind at compile time', () => {
    const partial: { [K in Exclude<TargetKind, 'probe'>]: ObjectKindModule<K> | null } = {
      star: null,
      cloud: null,
      lg: null,
      planet: null,
      shell: null,
    };
    // @ts-expect-error — a KindModules record without every TargetKind row must not compile
    const bad: KindModules = partial;
    expect(bad).toBeDefined();
  });
});

/** A record whose only module is a stub of `kind`, so the collectors run
 *  over one real row and five nulls. */
function recordWith(kind: TargetKind, module: Partial<ObjectKindModule>): KindModules {
  const record = Object.fromEntries(
    KIND_ROSTER.map((k) => [k, k === kind ? { kind, ...module } : null]),
  );
  return record as unknown as KindModules;
}

describe('collectKindPicks', () => {
  it('takes the pick off the module hover provider, keyed by kind', () => {
    const pick = () => null;
    const picks = collectKindPicks(recordWith('probe', {
      hover: () => ({ kind: 'probe', pick, format: () => null }),
    }));
    // Identity, not equality: the click FSM must run the very function
    // the hover engine runs, or the two can disagree on a hit.
    expect(picks.probe).toBe(pick);
    expect(Object.keys(picks)).toEqual(['probe']);
  });

  it('skips a module with no hover provider', () => {
    expect(collectKindPicks(recordWith('probe', {}))).toEqual({});
    expect(collectKindPicks(buildKindModules()).probe).toBeTypeOf('function');
  });
});

describe('displayNameOf', () => {
  it('routes star to the injected callback, never the roster', () => {
    const name = displayNameOf(recordWith('probe', {
      displayName: () => 'Voyager 1',
    }), { kind: 'star', idx: 7 }, (idx) => `star-${idx}`);
    expect(name).toBe('star-7');
  });

  it('routes a module kind to its displayName leg', () => {
    const name = displayNameOf(recordWith('probe', {
      displayName: (idx) => `probe-${idx}`,
    }), { kind: 'probe', idx: 2 }, () => 'unused');
    expect(name).toBe('probe-2');
  });

  it("answers '' for a kind whose module row is null", () => {
    const name = displayNameOf(recordWith('probe', {
      displayName: () => 'Voyager 1',
    }), { kind: 'cloud', idx: 0 }, () => 'unused');
    expect(name).toBe('');
  });
});

describe('mergeKindDetailBinds', () => {
  it('flattens every module push into one element-keyed record', () => {
    const markers = (_on: boolean) => {};
    const merged = mergeKindDetailBinds(recordWith('probe', {
      detailBinds: () => ({ probeMarkers: markers }),
    }));
    expect(merged.probeMarkers).toBe(markers);
    expect(mergeKindDetailBinds(recordWith('probe', {}))).toEqual({});
  });

  it('throws rather than letting one kind clobber another kind element', () => {
    const record = recordWith('probe', {
      detailBinds: () => ({ probeMarkers: () => {} }),
    }) as { -readonly [K in keyof KindModules]: KindModules[K] };
    record.planet = {
      kind: 'planet',
      detailBinds: () => ({ probeMarkers: () => {} }),
    } as unknown as KindModules['planet'];
    expect(() => mergeKindDetailBinds(record)).toThrow(/probeMarkers/);
  });

  it('carries every module declutter element exactly once', () => {
    const merged = mergeKindDetailBinds(buildKindModules());
    expect(Object.keys(merged).sort()).toEqual([
      'heliopauseShell', 'localBubbleShell', 'probeMarkers', 'probeTrails',
    ]);
  });
});
