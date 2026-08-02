// The Local Group ObjectKindModule — load/attach for the wireframe +
// emission layer pair plus every capability leg. See ./README.md.

import { softOrbitFloor } from '../camera/focus/focus-controller';
import type { FocusableProvider } from '../camera/focus/focus-target';
import { parkDistance } from '../camera/focus/focus-transition';
import { createLgFocusProvider } from '../focus-card/lg-focus-provider';
import type { FocusCardProvider } from '../focus-card/focus-card-types';
import { pickHdrEmitterUniforms } from '../hdr/hdr-pipeline';
import { formatLocalGroupHover } from '../hover/formatters/local-group-hover-format';
import type { HoverProvider } from '../hover/hover-types';
import type {
  KindContext,
  KindSearchEntry,
  ObjectKindModule,
} from '../kinds/kind-module';
import { updateWarpGatedRefLayer, type SceneLayer } from '../scene/scene-layer';
import { createLocalGroupLabels, LocalGroupLayer } from './local-group';
import { LocalGroupEmission } from './local-group-emission';
import {
  lgViewingDistancePc,
  loadLocalGroup,
  maxSemiAxisPc,
  type LgCatalog,
} from './local-group-loader';

/** Static dropdown-row distance for a Local Group entry. Fixed units by
 *  scale (kpc / Mpc) rather than the live pc/ly toggle — the corpus is
 *  built once and galaxy distances read naturally in kpc either way. */
export function formatLgSearchDistance(pc: number): string {
  if (pc >= 1_000_000) return `${(pc / 1_000_000).toFixed(2)} Mpc`;
  return `${Math.round(pc / 1000)} kpc`;
}

export interface LgKindModule extends ObjectKindModule<'lg'> {
  /** The wireframe layer, for label wiring + dev-console reads. Null
   *  before attach and when local-group.json is absent. */
  readonly layer: LocalGroupLayer | null;
  /** The volumetric emission layer (dev-console brightness levers). */
  readonly emission: LocalGroupEmission | null;
  /** Effective emission visibility — the shell ANDs the `lgEmissionGlow`
   *  declutter permission with the user's `showLgEmission` toggle and
   *  pushes the result here on either change. */
  setEmissionEnabled(on: boolean): void;
}

export function createLgKindModule(): LgKindModule {
  let catalog: LgCatalog | null = null;
  let ctx: KindContext | null = null;
  let layer: LocalGroupLayer | null = null;
  let emission: LocalGroupEmission | null = null;
  let disposeLabels: (() => void) | null = null;

  const lgPark = (idx: number): number => {
    const obj = catalog?.objects[idx];
    if (!obj) return 0;
    return parkDistance({
      R_pc: maxSemiAxisPc(obj),
      dMinFloor: lgViewingDistancePc(obj),
    });
  };

  return {
    kind: 'lg',

    get layer(): LocalGroupLayer | null {
      return layer;
    },
    get emission(): LocalGroupEmission | null {
      return emission;
    },
    setEmissionEnabled: (on) => emission?.setEnabled(on),

    async load(baseUrl: string): Promise<void> {
      catalog = await loadLocalGroup(`${baseUrl}local-group.json`);
    },

    attach(kindCtx: KindContext): SceneLayer | null {
      ctx = kindCtx;
      if (!catalog || catalog.objects.length === 0) return null;
      layer = new LocalGroupLayer(catalog);
      layer.setMonochrome(kindCtx.getMonochrome());
      kindCtx.scene.add(layer.group);
      emission = new LocalGroupEmission(catalog.objects, {
        hdr: pickHdrEmitterUniforms(kindCtx.sharedUniforms),
      });
      emission.setChartHidden(kindCtx.getMonochrome());
      kindCtx.scene.add(emission.group);
      return {
        update: (fc) => {
          updateWarpGatedRefLayer(layer, fc, kindCtx.detailPermits('lgWireframes'));
          emission!.update(fc.worldOffset);
        },
        setMonochrome: (on) => {
          layer!.setMonochrome(on);
          emission!.setChartHidden(on);
        },
        dispose: () => {
          disposeLabels?.();
          disposeLabels = null;
          kindCtx.scene.remove(layer!.group);
          kindCtx.scene.remove(emission!.group);
          layer!.dispose();
          emission!.dispose();
        },
      };
    },

    focusable: (): FocusableProvider => ({
      anchorInto: (idx, out) => {
        const obj = catalog?.objects[idx];
        if (!obj) return false;
        out.copy(obj.centerAbs);
        return true;
      },
      localPositionInto: (idx, out) =>
        layer?.lgLocalPositionInto(idx, ctx!.getWorldOffset(), out) ?? false,
      focusParkDistance: lgPark,
      orbitFloor: softOrbitFloor(lgPark),
      arrivalRadiusPc: () => null,
      renderedSizePx: (idx) =>
        layer?.renderedLgSizePx(idx, ctx!.camera, ctx!.getWorldOffset(), () =>
          ctx!.angularToPx()) ?? 0,
      chartPlateauDistance: () => null,
      planetSystemHost: () => null,
    }),

    card: (): FocusCardProvider<'lg'> => createLgFocusProvider({
      objects: catalog?.objects ?? null,
      cameraDistancePc: (idx) => {
        const obj = catalog!.objects[idx];
        const w = ctx!.getWorldOffset();
        const c = ctx!.camera.position;
        return Math.hypot(
          obj.centerAbs.x - w.x - c.x,
          obj.centerAbs.y - w.y - c.y,
          obj.centerAbs.z - w.z - c.z,
        );
      },
      constellationName: (idx) => ctx?.constellationOf('lg', idx) ?? null,
    }),

    hover: (): HoverProvider<'local-group'> => ({
      kind: 'local-group',
      pick: (clientX, clientY, pxThreshold) => {
        if (!ctx || !layer) return null;
        return layer.pick(
          ctx.camera,
          ctx.getWorldOffset(),
          ctx.canvas.getBoundingClientRect(),
          clientX,
          clientY,
          pxThreshold,
        );
      },
      format: (hit) =>
        catalog
          ? formatLocalGroupHover(hit.idx, hit.cameraDistancePc, { objects: catalog.objects })
          : null,
    }),

    pinnable: (idx) => (catalog?.objects[idx]?.sid ?? 0) !== 0,

    searchEntries: (): KindSearchEntry[] => {
      if (!catalog) return [];
      const out: KindSearchEntry[] = [];
      catalog.objects.forEach((o, index) => {
        const displayCon = `${o.type} · ${formatLgSearchDistance(o.distanceFromSol)}`;
        for (const label of [o.name, ...(o.aliases ?? [])]) {
          out.push({ index, label, primary: o.name, displayCon });
        }
      });
      return out;
    },

    displayName: (idx) => catalog?.objects[idx]?.name ?? '',

    sids: () => (catalog ? catalog.objects.map((o) => o.sid) : null),

    labels: () => {
      if (ctx && layer) disposeLabels = createLocalGroupLabels(ctx, layer);
    },
  };
}
