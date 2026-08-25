// The molecular-cloud ObjectKindModule — load/attach plus every
// capability leg of the cloud kind. See ./README.md.

import * as THREE from 'three';
import { softOrbitFloor } from '../camera/focus/focus-controller';
import type { FocusableProvider } from '../camera/focus/focus-target';
import { parkDistance } from '../camera/focus/focus-transition';
import { createCloudFocusProvider } from '../focus-card/cloud-focus-provider';
import type { FocusCardProvider } from '../focus-card/focus-card-types';
import { formatCloudHover } from '../hover/formatters/cloud-hover-format';
import type { HoverHit, HoverProvider } from '../hover/hover-types';
import { absCameraDistancePc } from '../kinds/kind-geometry';
import type {
  KindContext,
  KindSearchEntry,
  ObjectKindModule,
} from '../kinds/kind-module';
import type { SceneLayer } from '../scene/scene-layer';
import { createMolecularCloudLabels } from './cloud-labels';
import { loadClouds, type CloudCatalog } from './cloud-loader';
import { loadCloudSurfaces, type CloudSurface } from './cloud-surfaces-loader';
import { MolecularClouds } from './molecular-clouds';

export interface CloudKindModule extends ObjectKindModule<'cloud'> {
  /** The render layer, for dev-console tuning + chart-mode name rows.
   *  Null before attach and when the clouds.json artifact is absent. */
  readonly layer: MolecularClouds | null;
  /** Silhouette pixel diameter at the live camera pose — the provider's
   *  renderedSizePx leg and the labels' screen-size gate. */
  renderedSizePx(idx: number): number;
}

export function createCloudKindModule(): CloudKindModule {
  let catalog: CloudCatalog | null = null;
  let surfaces: Map<number, CloudSurface> | null = null;
  let ctx: KindContext | null = null;
  let layer: MolecularClouds | null = null;
  let disposeLabels: (() => void) | null = null;
  const tmpLocal = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  const cloudPark = (idx: number): number => {
    if (!layer?.clouds[idx]) return 0;
    return parkDistance({
      R_pc: layer.focusExtentPc(idx),
      dMinFloor: layer.viewingDistancePc(idx),
    });
  };

  const pick = (clientX: number, clientY: number): HoverHit | null => {
    if (!ctx || !layer) return null;
    return layer.pick(
      ctx.camera,
      ctx.getWorldOffset(),
      ctx.canvas.getBoundingClientRect(),
      clientX,
      clientY,
      ctx.angularToPx(),
    );
  };

  const renderedSizePx = (idx: number): number => {
    if (!ctx || !layer) return 0;
    if (!layer.cloudLocalPositionInto(idx, ctx.getWorldOffset(), tmpLocal)) return 0;
    const camPos = ctx.camera.position;
    const dCam = tmpLocal.distanceTo(camPos);
    if (dCam < 1e-12) {
      return layer.renderedSizePx(idx, dCam, ctx.angularToPx());
    }
    // World-space unit direction from the cloud toward the camera. The
    // ellipsoid-fallback path rotates this into the cloud's local frame
    // so the silhouette bound tightens for axis-aligned views (prolate
    // end-on no longer overshoots by the prolate axis ratio).
    tmpDir.copy(camPos).sub(tmpLocal).multiplyScalar(1 / dCam);
    return layer.renderedSizePx(idx, dCam, ctx.angularToPx(), tmpDir);
  };

  return {
    kind: 'cloud',

    get layer(): MolecularClouds | null {
      return layer;
    },
    renderedSizePx,

    async load(baseUrl: string): Promise<void> {
      [catalog, surfaces] = await Promise.all([
        loadClouds(`${baseUrl}clouds.json`),
        loadCloudSurfaces(`${baseUrl}cloud-surfaces.bin`),
      ]);
    },

    attach(kindCtx: KindContext): SceneLayer | null {
      ctx = kindCtx;
      if (!catalog || catalog.clouds.length === 0) return null;
      layer = new MolecularClouds(catalog, surfaces, {
        uFovYRad: kindCtx.sharedUniforms.uFovYRad,
        uViewport: kindCtx.sharedUniforms.uViewport,
      }, kindCtx.webgpu?.cloudMaterials);
      layer.setMonochrome(kindCtx.getMonochrome());
      // Both cloud components have ported, so on a WebGPU boot they belong
      // in the scene that renders.
      (kindCtx.webgpu?.scene ?? kindCtx.scene).add(layer.group);
      return {
        // Clouds sit at fixed positions; nothing here rides either clock.
        timeBehaviour: { kind: 'static' },
        update: (fc) =>
          layer!.update(fc.worldOffset, kindCtx.detailPermits('molecularCloudEllipsoids')),
        setMonochrome: (on) => layer!.setMonochrome(on),
        dispose: () => {
          disposeLabels?.();
          disposeLabels = null;
          kindCtx.scene.remove(layer!.group);
          layer!.dispose();
        },
      };
    },

    focusable: (): FocusableProvider => ({
      anchorInto: (idx, out) => layer?.focusCenterAbsInto(idx, out) ?? false,
      localPositionInto: (idx, out) =>
        layer?.cloudLocalPositionInto(idx, ctx!.getWorldOffset(), out) ?? false,
      focusParkDistance: cloudPark,
      orbitFloor: softOrbitFloor(cloudPark),
      arrivalRadiusPc: () => null,
      renderedSizePx,
      chartPlateauDistance: () => null,
      planetSystemHost: () => null,
    }),

    card: (): FocusCardProvider<'cloud'> => createCloudFocusProvider({
      clouds: catalog?.clouds ?? null,
      cameraDistancePc: (idx) => absCameraDistancePc(ctx!, catalog!.clouds[idx].centerAbs),
      constellationName: (idx) => ctx?.constellationOf('cloud', idx) ?? null,
    }),

    hover: (): HoverProvider<'cloud'> => ({
      kind: 'cloud',
      pick,
      format: (hit) =>
        catalog ? formatCloudHover(hit.idx, hit.cameraDistancePc, { clouds: catalog.clouds }) : null,
    }),

    pinnable: () => false,

    searchEntries: (): KindSearchEntry[] => {
      if (!catalog) return [];
      const out: KindSearchEntry[] = [];
      catalog.clouds.forEach((c, index) => {
        for (const label of [c.name, ...(c.aliases ?? [])]) {
          out.push({ index, label, primary: c.name, displayCon: 'Molecular cloud' });
        }
      });
      return out;
    },

    displayName: (idx) => catalog?.clouds[idx]?.name ?? '',

    sids: () => (catalog ? catalog.clouds.map((c) => c.sid) : null),

    labels: () => {
      if (ctx && layer) disposeLabels = createMolecularCloudLabels(ctx, layer, renderedSizePx);
    },
  };
}
