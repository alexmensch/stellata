// The kind-module roster: KIND_ROSTER order + buildKindModules record.
// See ./README.md.

import type { FocusableProviders, Target, TargetKind } from '../camera/focus/focus-target';
import type { PoiStoreDeps } from '../poi/poi-store';
import { createShellKindModule } from '../fresnel-shell/shell-module';
import { createLgKindModule } from '../local-group/lg-module';
import { createCloudKindModule } from '../molecular-clouds/cloud-module';
import type { DetailPushes } from '../scene/declutter/scene-declutter';
import { createPlanetKindModule } from '../solar-system/planets/planet-module';
import {
  createProbeKindModule,
} from '../solar-system/probes/probe-module';
import { createStarKindModule } from '../star-pipeline/star-module';
import type { KindLoadProgress, KindPick, ObjectKindModule } from './kind-module';

/** Explicit ordered roster — attach order IS scene-layer update order
 *  for module-supplied layers, and every module layer updates before
 *  every inline-wired layer. That boundary, not the order within this
 *  list, is what keeps the moving-body fields fresh for the
 *  moving-focal ride (`../scene/README.md`). */
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

/** A factory rather than a module-scope constant because modules are
 *  stateful — they hold their loaded artifact and attach-time runtime. */
export function buildKindModules() {
  return {
    star: createStarKindModule(),
    cloud: createCloudKindModule(),
    lg: createLgKindModule(),
    planet: createPlanetKindModule(),
    shell: createShellKindModule(),
    probe: createProbeKindModule(),
  } satisfies KindModules;
}

export type BuiltKindModules = ReturnType<typeof buildKindModules>;

/** Boot's load fan-out, one promise per roster entry for its
 *  `Promise.all`. `critical` is what makes the never-rejects rule a
 *  guarantee rather than a per-module convention: only the critical
 *  module's rejection propagates (boot's catch is the error screen);
 *  every other kind's is swallowed here, leaving that kind's roster
 *  empty. `onProgress` goes to the critical module alone — nothing else
 *  is on the first-paint path. */
export function loadKindModules(
  modules: KindModules,
  baseUrl: string,
  onProgress: (p: KindLoadProgress) => void,
): Promise<void>[] {
  return KIND_ROSTER.map(async (kind) => {
    const m = modules[kind];
    if (!m) return;
    if (m.critical) return m.load(baseUrl, onProgress);
    try {
      await m.load(baseUrl);
    } catch (err) {
      console.error(`kind module '${kind}' load rejected; its roster stays empty`, err);
    }
  });
}

/** Display name for any Target through the module roster; a null module
 *  row or a nameless index answers '' — callers pick their own
 *  fallback. */
export function displayNameOf(modules: KindModules, t: Target): string {
  return modules[t.kind]?.displayName(t.idx) ?? '';
}

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

export function collectFocusables(modules: BuiltKindModules): FocusableProviders {
  return rosterRecord((kind) => modules[kind].focusable());
}

export function collectPinnable(modules: BuiltKindModules): PoiStoreDeps['pinnable'] {
  return rosterRecord((kind) => (idx: number) => modules[kind].pinnable(idx));
}

// The cast is sound only because RosterCoversEveryKind holds KIND_ROSTER to every TargetKind.
function rosterRecord<V>(row: (kind: TargetKind) => V): { readonly [K in TargetKind]: V } {
  return Object.fromEntries(KIND_ROSTER.map((kind) => [kind, row(kind)])) as { [K in TargetKind]: V };
}

/** Every module's declutter pushes, in roster order, for `SceneDeclutter`
 *  to merge. */
export function collectKindDetailBinds(modules: KindModules): DetailPushes[] {
  return KIND_ROSTER.flatMap((kind) => modules[kind]?.detailBinds?.() ?? []);
}
