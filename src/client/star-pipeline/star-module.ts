// The star ObjectKindModule — catalog + search-index load and the star
// kind's capability legs. Render layers stay on the shell. See ./README.md.

import * as THREE from 'three';
import {
  CATALOG_MANIFEST_FILENAME,
  type SearchEntry,
} from '../../../scripts/catalog/catalog-pure';
import type { BinariesData } from '../binaries/binaries-loader';
import * as starPhysics from '../camera/controls/star-physics';
import type { FocusableProvider } from '../camera/focus/focus-target';
import { chartPlateauDistancePc } from '../chart-mode/chart-disc-pure';
import type { FocusCardProvider } from '../focus-card/focus-card-types';
import { createStarFocusProvider } from '../focus-card/star-focus-provider';
import { resolveStarName } from '../format/star-companion-format';
import { formatStarHover } from '../hover/formatters/star-hover-format';
import type { HoverHit, HoverProvider } from '../hover/hover-types';
import type {
  KindContext,
  KindLoadProgress,
  KindSearchEntry,
  ObjectKindModule,
} from '../kinds/kind-module';
import { loadCatalog, type Catalog } from '../loaders/catalog-loader';
import type { SceneLayer } from '../scene/scene-layer';
import { tToJDE } from '../solar-system/time/time';
import { MIN_PHYSICAL_RADIUS_R_SUN, R_SUN_PC } from '../util/astronomy-constants';

/** Shell-owned star machinery the module's legs read through closures —
 *  the star render pipeline, its frame state, and the picker stay on the
 *  integration shell, so the shell injects these before it reads any
 *  leg. */
export interface StarModuleRuntime {
  /** Local-frame position of star `idx` into `out` (StarFrame). */
  localPositionInto(idx: number, out: THREE.Vector3): THREE.Vector3;
  /** Auto-park distance for star `idx` (FocusController). */
  parkDistForStar(idx: number): number;
  /** Rendered disc diameter in CSS px — the shader-sizing CPU mirror. */
  renderedSizePx(idx: number): number;
  /** The Picker's two-tier star pick, shared by hover and the click FSM. */
  pickStarHit(clientX: number, clientY: number, pixelThreshold: number): HoverHit | null;
}

/** Search-corpus derivations boot builds from the loaded search index
 *  and hands back — the star display-name / spectral / designation
 *  tables every card tier reads. */
export interface StarNameTables {
  starLabels: Map<number, string>;
  spectralMap: Map<number, string>;
  searchEntries: Map<number, SearchEntry>;
}

export interface StarKindModule extends ObjectKindModule<'star'> {
  /** The decoded catalog. Valid after `load`. */
  readonly catalog: Catalog;
  /** The raw search-index rows. Valid after `load`; boot derives the
   *  name tables from them and hands the maps back via
   *  `setNameTables`. */
  readonly searchIndex: SearchEntry[];
  setRuntime(runtime: StarModuleRuntime): void;
  setNameTables(tables: StarNameTables): void;
  setBinaries(binaries: BinariesData | null): void;
}

export function createStarKindModule(): StarKindModule {
  let catalog: Catalog | null = null;
  let searchIndex: SearchEntry[] | null = null;
  let ctx: KindContext | null = null;
  let runtime: StarModuleRuntime | null = null;
  let binaries: BinariesData | null = null;
  let starLabels = new Map<number, string>();
  let spectralMap = new Map<number, string>();
  let searchEntries = new Map<number, SearchEntry>();
  const tmpLocal = new THREE.Vector3();

  const nameCtx = () => ({
    starLabels,
    gaiaSourceId: catalog!.gaiaSourceId,
    sid: catalog!.sid,
  });

  return {
    kind: 'star',
    critical: true,

    get catalog(): Catalog {
      if (!catalog) throw new Error('star module read before load');
      return catalog;
    },
    get searchIndex(): SearchEntry[] {
      if (!searchIndex) throw new Error('star module read before load');
      return searchIndex;
    },
    setRuntime(rt) {
      runtime = rt;
    },
    setNameTables(tables) {
      starLabels = tables.starLabels;
      spectralMap = tables.spectralMap;
      searchEntries = tables.searchEntries;
    },
    setBinaries(b) {
      binaries = b;
    },

    async load(baseUrl: string, onProgress?: (p: KindLoadProgress) => void): Promise<void> {
      [catalog, searchIndex] = await Promise.all([
        loadCatalog(
          `${baseUrl}${CATALOG_MANIFEST_FILENAME}`,
          `${baseUrl}constellations.json`,
          onProgress,
        ),
        fetch(`${baseUrl}search-index.json`).then(
          (r) => r.json() as Promise<SearchEntry[]>,
        ),
      ]);
    },

    attach(kindCtx: KindContext): SceneLayer | null {
      ctx = kindCtx;
      // The star render layers (pipeline, local mirror, binary fields)
      // are shell-wired engine machinery, not a module scene layer.
      return null;
    },

    focusable: (): FocusableProvider => ({
      anchorInto: (idx, out) => {
        if (!catalog || idx < 0 || idx >= catalog.count) return false;
        const p = catalog.positions;
        out.set(p[idx * 3], p[idx * 3 + 1], p[idx * 3 + 2]);
        return true;
      },
      localPositionInto: (idx, out) => {
        if (!catalog || !runtime || idx < 0 || idx >= catalog.count) return false;
        runtime.localPositionInto(idx, out);
        return true;
      },
      focusParkDistance: (idx) => runtime?.parkDistForStar(idx) ?? 0,
      orbitFloor: (idx) => (catalog && ctx
        ? starPhysics.minOrbitDistForStar({
          catalog,
          idx,
          fovMinorRad: starPhysics.fovMinorRad(ctx.camera),
        })
        : 0),
      arrivalRadiusPc: (idx) => (catalog
        ? Math.max(catalog.physicalRadius[idx], MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC
        : null),
      renderedSizePx: (idx) => runtime?.renderedSizePx(idx) ?? 0,
      chartPlateauDistance: (idx, magBright) => (catalog
        ? chartPlateauDistancePc(catalog.absmag[idx], magBright)
        : null),
      planetSystemHost: (idx) => idx,
    }),

    card: (): FocusCardProvider<'star'> => {
      if (!catalog) throw new Error('star module card read before load');
      return createStarFocusProvider({
        catalog,
        starLabels,
        spectralMap,
        searchEntries,
        binaries,
        cameraDistancePc: (idx) => (runtime && ctx
          ? runtime.localPositionInto(idx, tmpLocal).distanceTo(ctx.camera.position)
          : 0),
        nowJd: () => tToJDE(ctx?.getT() ?? 0),
      });
    },

    hover: (): HoverProvider<'star'> => ({
      kind: 'star',
      pick: (x, y, pxThreshold) => runtime?.pickStarHit(x, y, pxThreshold) ?? null,
      // `nowJd` is sampled fresh so the Tier-1 live separation tracks
      // the sim clock.
      format: (hit) => (catalog && ctx
        ? formatStarHover(hit.idx, hit.cameraDistancePc, {
          ...nameCtx(),
          spectralMap,
          spectClass: catalog.spectClass,
          luminosityClass: catalog.luminosityClass,
          flags: catalog.flags,
          constellation: catalog.constellation,
          constellations: catalog.constellations,
          periodDays: catalog.periodDays,
          amplitudeMag: catalog.amplitudeMag,
          binaries,
          nowJd: tToJDE(ctx.getT()),
          membership: ctx.systemMembership,
        })
        : null),
    }),

    pinnable: (idx) =>
      catalog !== null && idx >= 0 && idx < catalog.count && catalog.sid[idx] !== 0,

    // The star corpus enters through buildSearchIndex's richer channel
    // (designation-tier fuzzy labels + the direct-lookup ID maps that
    // KindSearchEntry rows cannot carry) — createSearchRunner takes the
    // raw index directly, so this leg answers empty rather than
    // double-entering the stars.
    searchEntries: (): KindSearchEntry[] => [],

    displayName: (idx) => (catalog ? resolveStarName(nameCtx(), idx) : ''),

    sids: () => catalog?.sid ?? null,

    setFocalHidden: (idx) => {
      if (ctx) ctx.sharedUniforms.uHideFocusIdx.value = idx;
    },
  };
}
