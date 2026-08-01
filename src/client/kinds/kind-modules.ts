// The kind-module roster: KIND_ROSTER order + buildKindModules record.
// See ./README.md.

import type { TargetKind } from '../camera/focus/focus-target';
import type { SceneElementId } from '../scene/scene-elements';
import {
  createProbeKindModule,
} from '../solar-system/probes/probe-module';
import type { ObjectKindModule } from './kind-module';

/** EXHAUSTIVE over TargetKind — a kind without an entry (module or an
 *  explicit null while its wiring is still inline) fails tsc. Don't
 *  weaken it to a partial map. */
export type KindModules = { readonly [K in TargetKind]: ObjectKindModule<K> | null };

/** Explicit ordered roster — attach order IS scene-layer update order
 *  for module-supplied layers, and module layers update before every
 *  inline-wired layer. Probe leads: its field must write this frame's
 *  samples before the planet layer's moving-focal ride reads them. */
export const KIND_ROSTER = [
  'probe',
  'planet',
  'star',
  'cloud',
  'lg',
  'shell',
] as const satisfies readonly TargetKind[];

/** Build the per-shell KIND_MODULES record. A factory rather than a
 *  module-scope constant because modules are stateful (they hold their
 *  loaded artifact and attach-time runtime); null entries are kinds
 *  whose wiring is still inline, migrated in later epic phases. */
export function buildKindModules() {
  return {
    star: null,
    cloud: null,
    lg: null,
    planet: null,
    shell: null,
    probe: createProbeKindModule(),
  } satisfies KindModules;
}

export type BuiltKindModules = ReturnType<typeof buildKindModules>;

export type KindDetailBinds = Partial<Record<SceneElementId, (on: boolean) => void>>;

/** Flatten every module's declutter pushes into one element-keyed
 *  record for the shell's exhaustive bind builder. Two kinds claiming
 *  the same element throws rather than silently clobbering — the
 *  merged record is keyless about which module wrote a row. */
export function mergeKindDetailBinds(modules: KindModules): KindDetailBinds {
  const merged: KindDetailBinds = {};
  for (const kind of KIND_ROSTER) {
    const binds = modules[kind]?.detailBinds?.();
    if (!binds) continue;
    for (const [id, push] of Object.entries(binds) as [SceneElementId, ((on: boolean) => void) | undefined][]) {
      if (!push) continue;
      if (merged[id]) throw new Error(`scene element '${id}' claimed by two kind modules`);
      merged[id] = push;
    }
  }
  return merged;
}
