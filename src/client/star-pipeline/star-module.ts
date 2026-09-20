// The star ObjectKindModule — catalog + search-index load and the star
// kind's capability legs. Render layers stay on the shell. See ./README.md.

import * as THREE from 'three';
import {
  CATALOG_MANIFEST_FILENAME,
  type SearchEntry,
} from '../../../scripts/catalog/record/catalog-pure';
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
import { StarShardTable } from './shards/star-shard-table';
import { catalogShard } from './shards/star-shards-pure';
import { tToJdUt } from '../solar-system/time/time';
import {
  buildSpectralMap, buildStarLabels, seedStarLabelsFromNames,
} from '../typeahead/star-name-tables';
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
  /** The Picker's star pick, shared by hover and the click FSM. */
  pickStarHit(clientX: number, clientY: number, pixelThreshold: number): HoverHit | null;
  /** Orbital elements for the companion lines; null with no artifact.
   *  Read per format call — the shell can re-attach binaries after the
   *  card provider is built. */
  getBinaries(): BinariesData | null;
}

export interface StarKindModule extends ObjectKindModule<'star'> {
  /** Valid after `load`. */
  readonly catalog: Catalog;
  /** The kind's population shards mapped into flat Target.idx space —
   *  the catalog is shard 0. Valid after `load`. */
  readonly shardTable: StarShardTable;
  /** Valid after `load`. */
  readonly searchIndex: SearchEntry[];
  /** Star idx → display label, derived from the search index. One map
   *  instance for the module's lifetime, filled in place when the index
   *  lands, so a consumer that captured it at boot sees the labels appear.
   *  Chart mode and the planet card's host breadcrumb read the same
   *  table the module's own name ladder does. */
  readonly starLabels: Map<number, string>;
  /** Settles when the whole catalogue and the search index have landed and
   *  every table derived from them is built. `load` resolves far earlier —
   *  on the catalogue's first chunk — so anything needing the COMPLETE
   *  population waits here instead (`../loaders/README.md` § Progressive
   *  catalog load). */
  readonly ready: Promise<void>;
  /** Absolute V magnitude + floored physical radius (pc) of star `idx`;
   *  null out of range or before load. Backs `KindContext.starPhotometry`
   *  — the module owns the catalog, so the formula lives here only. */
  photometry(idx: number): { absMag: number; radiusPc: number } | null;
  setRuntime(runtime: StarModuleRuntime): void;
}

export function createStarKindModule(): StarKindModule {
  let catalog: Catalog | null = null;
  let shardTable: StarShardTable | null = null;
  let searchIndex: SearchEntry[] | null = null;
  let ctx: KindContext | null = null;
  let runtime: StarModuleRuntime | null = null;
  let ready: Promise<void> = Promise.resolve();
  let offRecords: (() => void) | null = null;
  // Filled in place rather than reassigned — every card provider, chart
  // binding and hover formatter captures these at boot, before the search
  // index has landed.
  const starLabels = new Map<number, string>();
  const spectralMap = new Map<number, string>();
  const searchEntryById = new Map<number, SearchEntry>();
  const tmpLocal = new THREE.Vector3();

  const nameCtx = () => ({
    starLabels,
    gaiaSourceId: catalog!.gaiaSourceId,
    sid: catalog!.sid,
  });

  const photometryOf = (idx: number) => (catalog && idx >= 0 && idx < catalog.count
    ? {
      absMag: catalog.absmag[idx],
      radiusPc: Math.max(catalog.physicalRadius[idx], MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC,
    }
    : null);

  return {
    kind: 'star',
    critical: true,

    get catalog(): Catalog {
      if (!catalog) throw new Error('star module read before load');
      return catalog;
    },
    get shardTable(): StarShardTable {
      if (!shardTable) throw new Error('star module read before load');
      return shardTable;
    },
    get searchIndex(): SearchEntry[] {
      if (!searchIndex) throw new Error('star module read before load');
      return searchIndex;
    },
    get starLabels(): Map<number, string> {
      if (!catalog) throw new Error('star module read before load');
      return starLabels;
    },
    get ready(): Promise<void> { return ready; },
    photometry: photometryOf,
    setRuntime(rt) {
      runtime = rt;
    },

    /** Resolves on the catalogue's FIRST chunk, so boot can paint. The
     *  search index is deliberately not awaited here — it is 4.4 MB gzipped
     *  and feeds only search, chart labels and designations, none of which
     *  is on the first-paint path. Both land under `ready`. */
    async load(baseUrl: string, onProgress?: (p: KindLoadProgress) => void): Promise<void> {
      const index = fetch(`${baseUrl}search-index.json`).then(
        (r) => r.json() as Promise<SearchEntry[]>,
      );
      catalog = await loadCatalog(
        `${baseUrl}${CATALOG_MANIFEST_FILENAME}`,
        `${baseUrl}constellations.json`,
        onProgress,
      );
      // Sized off the header count, which chunk 0 carries, so the shard's
      // SID domain spans the whole population from the start.
      shardTable = new StarShardTable([catalogShard(catalog)]);
      // Names ride chunk 0 and every chunk after it, so the label ladder's
      // authority tier is live from first paint — a focused Sol shows
      // "Sol", not the SID fallback, while the search index is still on the
      // wire.
      seedStarLabelsFromNames(catalog, starLabels);
      offRecords?.();
      offRecords = catalog.onRecordsDecoded(
        () => seedStarLabelsFromNames(catalog!, starLabels),
      );
      const loaded = catalog;
      ready = (async () => {
        const [, raw] = await Promise.all([loaded.whenComplete, index]);
        searchIndex = raw;
        // The per-chunk seeding above has done its job; this pass redoes it
        // and adds the composed-designation tier.
        offRecords?.();
        offRecords = null;
        buildStarLabels(loaded, raw, starLabels);
        buildSpectralMap(raw, spectralMap);
        for (const e of raw) searchEntryById.set(e.i, e);
      })();
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
      arrivalRadiusPc: (idx) => photometryOf(idx)?.radiusPc ?? null,
      renderedSizePx: (idx) => runtime?.renderedSizePx(idx) ?? 0,
      chartPlateauDistance: (idx, magBright) => (catalog
        ? chartPlateauDistancePc(catalog.absmag[idx], magBright)
        : null),
      planetSystemHost: (idx) => idx,
    }),

    // The one leg that throws rather than answering absence: every row
    // it builds needs the catalog and the clock, and a card built
    // pre-attach would read t=0 (J2000) as if it were the sim time.
    card: (): FocusCardProvider<'star'> => {
      const cat = catalog;
      const attached = ctx;
      if (!cat || !attached) throw new Error('star module card read before load + attach');
      return createStarFocusProvider({
        catalog: cat,
        starLabels,
        spectralMap,
        searchEntries: searchEntryById,
        getBinaries: () => runtime?.getBinaries() ?? null,
        cameraDistancePc: (idx) => (runtime
          ? runtime.localPositionInto(idx, tmpLocal).distanceTo(attached.camera.position)
          : 0),
        nowJd: () => tToJdUt(attached.getT()),
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
          binaries: runtime?.getBinaries() ?? null,
          nowJd: tToJdUt(ctx.getT()),
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

    sids: () => shardTable?.sids() ?? null,

    setFocalHidden: (idx) => {
      if (ctx) ctx.sharedUniforms.uHideFocusIdx.value = idx;
    },
  };
}
