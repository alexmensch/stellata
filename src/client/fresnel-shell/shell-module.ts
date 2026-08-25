// The boundary-shell ObjectKindModule — one module, two instances
// (heliopause + Local Bubble) over the internal ShellRegistry. See
// ./README.md § Boundary shells as focus targets.

import * as THREE from 'three';
import { softOrbitFloor } from '../camera/focus/focus-controller';
import type { FocusableProvider } from '../camera/focus/focus-target';
import { createShellFocusProvider } from '../focus-card/shell-focus-provider';
import type { FocusCardProvider } from '../focus-card/focus-card-types';
import { formatShellHover } from '../hover/formatters/shell-hover-format';
import type { HoverHit, HoverProvider } from '../hover/hover-types';
import type {
  KindContext,
  KindSearchEntry,
  ObjectKindModule,
} from '../kinds/kind-module';
import { createLocalBubbleLabel, LocalBubbleShell, LOCAL_BUBBLE_CARD, LOCAL_BUBBLE_LABEL } from '../local-bubble/local-bubble';
import { loadLocalBubble, type LocalBubbleMesh } from '../local-bubble/local-bubble-loader';
import type { SceneLayer } from '../scene/scene-layer';
import {
  createHeliopauseLabel,
  Heliopause,
  HELIOPAUSE_CARD,
  HELIOPAUSE_EXTENT_PC,
  HELIOPAUSE_LABEL,
} from '../solar-system/heliopause/heliopause';
import { SHELL_OBJECT_SIDS } from './shell-object-sids';
import { pickShellSilhouette } from './shell-pick';
import { SHELL_KEYS, ShellRegistry } from './shell-registry';

export interface ShellKindModule extends ObjectKindModule<'shell'> {
  /** The per-instance registry — the kind's internal runtime, exposed
   *  for tests and cross-shell reads. Populated by `attach`. */
  readonly registry: ShellRegistry;
}

export function createShellKindModule(): ShellKindModule {
  const registry = new ShellRegistry();
  let mesh: LocalBubbleMesh | null = null;
  let ctx: KindContext | null = null;
  let heliopause: Heliopause | null = null;
  let localBubble: LocalBubbleShell | null = null;
  const disposeLabels: (() => void)[] = [];
  const tmpSolAbs = new THREE.Vector3();
  const tmpPick = new THREE.Vector3();

  const shellPark = (idx: number): number => registry.focusParkDistancePc(idx);

  const pick = (clientX: number, clientY: number): HoverHit | null => {
    if (!ctx) return null;
    const rect = ctx.canvas.getBoundingClientRect();
    const worldOffset = ctx.getWorldOffset();
    const cameraPos = ctx.camera.position;
    let best: HoverHit | null = null;
    for (let idx = 0; idx < registry.count; idx++) {
      const shell = registry.at(idx);
      if (!shell || !shell.pick.visible()) continue;
      const hit = pickShellSilhouette({
        camera: ctx.camera,
        rect,
        clientX,
        clientY,
        worldOffset,
        surface: shell.pick,
        cameraDistancePc: registry.cameraDistancePc(idx, worldOffset, cameraPos),
        idx,
        scratch: tmpPick,
      });
      if (hit && (best === null || hit.cameraDistancePc < best.cameraDistancePc)) best = hit;
    }
    return best;
  };

  return {
    kind: 'shell',

    get registry(): ShellRegistry {
      return registry;
    },

    async load(baseUrl: string): Promise<void> {
      // Never rejects (module contract): a fetch failure or a corrupt
      // buffer (parseLocalBubble throws) degrades to an absent shell.
      try {
        mesh = await loadLocalBubble(`${baseUrl}local-bubble.bin`);
      } catch (err) {
        console.warn('local-bubble.bin failed to load; shell absent', err);
        mesh = null;
      }
    },

    attach(kindCtx: KindContext): SceneLayer {
      ctx = kindCtx;
      // Heliopause: Sol-anchored, mesh built in its ctor — registered
      // whenever a Sol record exists. Visibility is the declutter
      // cycle's call, never focus-coupled.
      // Both shells have ported, so on a WebGPU boot they belong in the
      // scene that renders.
      const renderScene = kindCtx.webgpu?.scene ?? kindCtx.scene;
      heliopause = new Heliopause(kindCtx.webgpu?.shellMaterials);
      renderScene.add(heliopause.group);
      if (kindCtx.solAbsInto(tmpSolAbs)) {
        const solAbs = tmpSolAbs.clone();
        registry.register('heliopause', {
          label: HELIOPAUSE_LABEL,
          sid: SHELL_OBJECT_SIDS.heliopause,
          card: HELIOPAUSE_CARD,
          centerAbsInto: (out) => {
            out.copy(solAbs);
            return true;
          },
          extentPc: () => HELIOPAUSE_EXTENT_PC,
          pick: heliopause.shellPickSurface(),
        });
      }
      // Local Bubble: the layer exists either way; the mesh (and the
      // registry slot) only with the artifact — an absent shell leaves
      // its slot empty and every dispatch falls through to null.
      localBubble = new LocalBubbleShell(kindCtx.webgpu?.shellMaterials);
      renderScene.add(localBubble.group);
      localBubble.recenter(kindCtx.getWorldOffset());
      if (mesh) {
        const data = mesh;
        localBubble.attach(data);
        localBubble.setMonochrome(kindCtx.getMonochrome());
        registry.register('local_bubble', {
          label: LOCAL_BUBBLE_LABEL,
          sid: SHELL_OBJECT_SIDS.local_bubble,
          card: LOCAL_BUBBLE_CARD,
          centerAbsInto: (out) => {
            out.set(data.centroidAbs[0], data.centroidAbs[1], data.centroidAbs[2]);
            return true;
          },
          extentPc: () => data.extentPc,
          pick: localBubble.shellPickSurface(),
        });
      }
      return {
        // Fixed boundary geometry; visibility is event-driven, not timed.
        timeBehaviour: { kind: 'static' },
        setMonochrome: (on) => {
          heliopause!.setMonochrome(on);
          localBubble!.setMonochrome(on);
        },
        recenter: (newOrigin) => {
          heliopause!.recenter(newOrigin);
          localBubble!.recenter(newOrigin);
        },
        dispose: () => {
          for (const stop of disposeLabels) stop();
          disposeLabels.length = 0;
          heliopause!.dispose();
          localBubble!.dispose();
        },
      };
    },

    focusable: (): FocusableProvider => ({
      anchorInto: (idx, out) => registry.at(idx)?.centerAbsInto(out) ?? false,
      localPositionInto: (idx, out) =>
        registry.localPositionInto(idx, ctx!.getWorldOffset(), out),
      focusParkDistance: shellPark,
      orbitFloor: softOrbitFloor(shellPark),
      arrivalRadiusPc: () => null,
      renderedSizePx: (idx) =>
        registry.renderedSizePx(
          idx,
          ctx!.getWorldOffset(),
          ctx!.camera.position,
          ctx!.angularToPx(),
        ),
      chartPlateauDistance: () => null,
      planetSystemHost: () => null,
    }),

    card: (): FocusCardProvider<'shell'> => createShellFocusProvider({
      shellAt: (idx) => registry.at(idx),
      cameraDistancePc: (idx) =>
        registry.cameraDistancePc(idx, ctx!.getWorldOffset(), ctx!.camera.position),
    }),

    hover: (): HoverProvider<'shell'> => ({
      kind: 'shell',
      pick,
      format: (hit) => {
        const shell = registry.at(hit.idx);
        return shell ? formatShellHover(shell, hit.cameraDistancePc) : null;
      },
    }),

    pinnable: (idx) => (registry.at(idx)?.sid ?? 0) !== 0,

    searchEntries: (): KindSearchEntry[] => {
      const out: KindSearchEntry[] = [];
      for (let i = 0; i < registry.count; i++) {
        const s = registry.at(i);
        if (!s) continue;
        out.push({ index: i, label: s.label, primary: s.label, displayCon: s.card.typeLine });
      }
      return out;
    },

    displayName: (idx) => registry.at(idx)?.label ?? '',

    // Both shells carry static, always-known SIDs (generated / curated
    // objects, docs/sid.md § 7) — the domain attaches even when a layer
    // is absent, and focus/pin fall through to null via the empty slot.
    sids: () => SHELL_KEYS.map((k) => SHELL_OBJECT_SIDS[k]),

    labels: () => {
      if (!ctx) return;
      disposeLabels.push(createHeliopauseLabel(ctx, registry));
      if (localBubble) disposeLabels.push(createLocalBubbleLabel(ctx, localBubble, registry));
    },

    detailBinds: () => ({
      heliopauseShell: (on) => heliopause?.setPermitted(on),
      localBubbleShell: (on) => localBubble?.setPermitted(on),
    }),
  };
}
