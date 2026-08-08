// The kind-module roster: KIND_ROSTER order + buildKindModules record.
// See ./README.md.

import type { TargetKind } from '../camera/focus/focus-target';
import { createShellKindModule } from '../fresnel-shell/shell-module';
import { createLgKindModule } from '../local-group/lg-module';
import { createCloudKindModule } from '../molecular-clouds/cloud-module';
import type { SceneElementId } from '../scene/scene-elements';
import {
  createProbeKindModule,
} from '../solar-system/probes/probe-module';
import type { KindPick, ObjectKindModule } from './kind-module';

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

/** `unknown` when KIND_ROSTER lists every TargetKind, `never` otherwise
 *  — intersected into `KindModules` so a missing roster line collapses
 *  the record type and fails `buildKindModules`. The exhaustive record
 *  can't catch this on its own: an unrostered kind still has a row, it
 *  just silently never loads, attaches, or answers a roster loop. */
type RosterCoversEveryKind =
  [Exclude<TargetKind, (typeof KIND_ROSTER)[number]>] extends [never] ? unknown : never;

/** EXHAUSTIVE over TargetKind — a kind without an entry (module or an
 *  explicit null while its wiring is still inline) fails tsc. Don't
 *  weaken it to a partial map. */
export type KindModules =
  { readonly [K in TargetKind]: ObjectKindModule<K> | null } & RosterCoversEveryKind;

/** Build the per-shell KIND_MODULES record. A factory rather than a
 *  module-scope constant because modules are stateful (they hold their
 *  loaded artifact and attach-time runtime); null entries are kinds
 *  whose wiring is still inline, migrated in later epic phases. */
export function buildKindModules() {
  return {
    star: null,
    cloud: createCloudKindModule(),
    lg: createLgKindModule(),
    planet: null,
    shell: createShellKindModule(),
    probe: createProbeKindModule(),
  } satisfies KindModules;
}

export type BuiltKindModules = ReturnType<typeof buildKindModules>;

/** Click-pick surfaces for `Picker.pickKindHit`, taken from each
 *  module's hover provider so the click FSM and the hover engine run
 *  the same function. */
export function collectKindPicks(modules: KindModules): Partial<Record<TargetKind, KindPick>> {
  const picks: Partial<Record<TargetKind, KindPick>> = {};
  for (const kind of KIND_ROSTER) {
    const pick = modules[kind]?.hover?.().pick;
    if (pick) picks[kind] = pick;
  }
  return picks;
}

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
