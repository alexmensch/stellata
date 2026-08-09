// Contract pins for the kind-module roster: coverage and order, record
// exhaustiveness, and the two shell-side collectors (pick surfaces and
// declutter pushes).

import { describe, expect, it, vi } from 'vitest';
import { KIND_TRAITS, type TargetKind } from '../camera/focus/focus-target';
import type { ObjectKindModule } from './kind-module';
import {
  buildKindModules,
  collectKindPicks,
  displayNameOf,
  KIND_ROSTER,
  loadKindModules,
  mergeKindDetailBinds,
  type KindModules,
} from './kind-modules';

describe('KIND_ROSTER', () => {
  it('covers every TargetKind exactly once', () => {
    const kinds = Object.keys(KIND_TRAITS).sort();
    expect([...KIND_ROSTER].sort()).toEqual(kinds);
    expect(new Set(KIND_ROSTER).size).toBe(KIND_ROSTER.length);
  });

  // Roster order IS module-layer update order, so a reorder changes
  // what renders when. No inter-kind draw dependency exists inside the
  // roster — the moving-focal ride reads every module field from the
  // first INLINE entry, after the whole roster has updated — so this
  // pins deliberateness, not a dependency.
  it('pins the exact order — a reorder is a render-order change', () => {
    expect([...KIND_ROSTER]).toEqual(['probe', 'planet', 'star', 'cloud', 'lg', 'shell']);
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

/** Roster record with the critical row (star) and one ordinary row
 *  (cloud) stubbed, every other kind null. */
function loadRecord(
  star: Partial<ObjectKindModule>,
  cloud: Partial<ObjectKindModule>,
): KindModules {
  const record = Object.fromEntries(KIND_ROSTER.map((k) => {
    if (k === 'star') return [k, { kind: k, critical: true, ...star }];
    if (k === 'cloud') return [k, { kind: k, ...cloud }];
    return [k, null];
  }));
  return record as unknown as KindModules;
}

describe('loadKindModules', () => {
  it('has exactly one critical module across the real roster', () => {
    const modules = buildKindModules();
    expect(KIND_ROSTER.filter((k) => modules[k]?.critical)).toEqual(['star']);
  });

  it('lets the critical module reject — boot treats that as fatal', async () => {
    const record = loadRecord(
      { load: () => Promise.reject(new Error('catalog 404')) },
      { load: async () => {} },
    );
    await expect(Promise.all(loadKindModules(record, '/base/', () => {})))
      .rejects.toThrow('catalog 404');
  });

  it('swallows a non-critical rejection so one artifact cannot blank the app', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const record = loadRecord(
      { load: async () => {} },
      { load: () => Promise.reject(new Error('clouds 404')) },
    );
    await expect(Promise.all(loadKindModules(record, '/base/', () => {})))
      .resolves.toBeDefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('hands the progress callback to the critical module alone', async () => {
    const starLoad = vi.fn(async () => {});
    const cloudLoad = vi.fn(async () => {});
    const onProgress = () => {};
    await Promise.all(
      loadKindModules(loadRecord({ load: starLoad }, { load: cloudLoad }), '/base/', onProgress),
    );
    expect(starLoad).toHaveBeenCalledWith('/base/', onProgress);
    expect(cloudLoad).toHaveBeenCalledWith('/base/');
  });
});

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
  it('routes any kind — star included — to its displayName leg', () => {
    const record = recordWith('probe', { displayName: (idx) => `probe-${idx}` });
    expect(displayNameOf(record, { kind: 'probe', idx: 2 })).toBe('probe-2');
    const starRecord = recordWith('star', { displayName: (idx) => `star-${idx}` });
    expect(displayNameOf(starRecord, { kind: 'star', idx: 7 })).toBe('star-7');
  });

  it("answers '' for a kind whose module row is null", () => {
    const name = displayNameOf(recordWith('probe', {
      displayName: () => 'Voyager 1',
    }), { kind: 'cloud', idx: 0 });
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
