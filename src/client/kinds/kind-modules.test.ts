// Contract pins for the kind-module roster: KIND_ROSTER covers every
// TargetKind exactly once, buildKindModules is exhaustive, and module
// kind tags match their record keys.

import { describe, expect, it } from 'vitest';
import { KIND_TRAITS, type TargetKind } from '../camera/focus/focus-target';
import type { ObjectKindModule } from './kind-module';
import { buildKindModules, KIND_ROSTER, type KindModules } from './kind-modules';

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
