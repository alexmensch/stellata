import { DustField, loadDustManifest } from './loaders/dust-loader';
import { loadBinaries } from './binaries/binaries-loader';
import { loadBoundaries } from './constellation-boundaries/boundary-artifact-loader';
import { createMilkyWayLabel } from './local-group/local-group';
import { Stellata } from './stellata';
import { bindControls } from './camera/controls/controls';
import { bindSearch, bindFindSearch } from './typeahead/search';
import type { BayerInfo } from './typeahead/star-name-tables';
import { createDistanceVectorOverlay } from './overlays/distance-vector-overlay';
import { createFocusRingOverlay } from './overlays/focus-ring-overlay';
import { createPoiOverlay } from './overlays/poi-overlay';
import { createClickRipple } from './overlays/click-ripple';
import { createPlanetLabels } from './solar-system/planets/labels/planet-labels';
import { buildKindModules, KIND_ROSTER, loadKindModules } from './kinds/kind-modules';
import type { KindLoadProgress } from './kinds/kind-module';
import { createScaleBar } from './ui/scale-bar';
import { createAttitudeIndicator } from './attitude/attitude-indicator';
import { createTimeScrubberWidget } from './solar-system/time/time-scrubber-widget';
import { bindUnitToggle } from './ui/unit-toggle';
import { createCoordSphereLabels } from './galactic/coord-spheres/coord-sphere-labels';
import {
  COORD_SPHERE_SPECS,
  DRAWN_COORD_SPHERE_FRAMES,
} from './galactic/coord-spheres/coord-sphere-frames';
import { registerThemeStellata } from './ui/theme-toggle';
import { bindChartMode } from './chart-mode/chart-mode';
import { bindPanelLayout } from './ui/panel-layout';
import { bindWarpButton } from './camera/warp/warp-button';
import { bindModeToggle } from './camera/controls/mode-toggle';
import { maybeShowInfoModal } from './modals/info-modal';
import { maybeShowMobileAdvisory } from './modals/mobile-advisory';
import { bindBrandModals } from './modals/brand-modal';
import { bindKeyboardShortcuts } from './ui/keyboard-shortcuts';
import { bindControlsHideToggle } from './ui/controls-hidden';
import { applyFromUrl, startUrlSync, type IdMaps } from './util/url-state';
import { resolveBootRoute } from './webgpu/boot-route';
import type { WebGpuSeam } from './webgpu/seam';
import { showWebGpuGate } from './webgpu/gate/gate-page';
import { detectWebGpuSupport } from './webgpu/gate/webgpu-support';
import { SidResolver, arrayDomain } from './util/sid-resolver';
import { applyFirstLoadView } from './solar-system/first-load';
import { setupDebug } from './debug/debug';
import { createHoverEngine } from './hover/hover-engine';
import { createCardRolodex } from './focus-card/card-rolodex';
import type { HoverProvider } from './hover/hover-types';

/** Hand the render loop a frame. Wave 2 builds several catalogue-wide
 *  tables back to back, and without a yield between them the scene — which
 *  is live by then — stops dead for their sum rather than hitching once per
 *  table. Yielding splits the block; it does not shrink it. */
const frame = () => new Promise<void>((r) => { requestAnimationFrame(() => r()); });

async function main() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const loading = document.getElementById('loading')!;
  const loadingBar = document.getElementById('loading-bar')!;
  const loadingStatus = document.getElementById('loading-status')!;
  const topbar = document.getElementById('topbar')!;
  const panel = document.getElementById('panel')!;
  const brandBox = document.getElementById('ui-top-left')!;
  const meta = document.getElementById('meta')!;
  const tooltip = document.getElementById('tooltip')!;

  // Byte progress of the star catalog. It keeps running past first paint:
  // the scene is live from chunk 0 and the rest of the population streams
  // in behind this panel (loaders/README.md#progressive-catalog-load).
  const showCatalogProgress = ({ bytes, total }: KindLoadProgress) => {
    loadingBar.style.width = `${((bytes / total) * 100).toFixed(0)}%`;
    loadingStatus.textContent =
      `${(bytes / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`;
  };

  // Ahead of the catalog fetch so a gated browser downloads nothing it
  // cannot use (webgpu/boot-route.ts).
  const route = await resolveBootRoute(location.hash, detectWebGpuSupport);
  if (route.kind === 'gate') {
    showWebGpuGate(route.verdict);
    return;
  }

  try {
    const kinds = buildKindModules();
    // Started here and awaited past the fetch: the async chunk and the
    // adapter init are latency the catalog download already pays for.
    // The dynamic import is the bundle boundary (webgpu/README.md#import-boundary--nothing-webgpu-in-the-entry-bundle).
    // The catch is not optional — nothing awaits
    // this for the length of the fetch, so a rejected chunk load would
    // surface as an unhandled rejection instead of a refused renderer.
    const webgpuBoot: Promise<WebGpuSeam | null> = import('./webgpu/boot-webgpu')
      .then(({ bootWebGpu }) => bootWebGpu(canvas))
      .catch((err) => {
        console.warn('WebGPU boot rejected:', err);
        return null;
      });
    const [binaries, boundaries] = await Promise.all([
      // Binary / multiple-star orbital elements. ~64 KB; null when the
      // artifact is missing (fresh checkout without
      // `pnpm run build:binaries`). The renderer renders identically
      // without the field; orbital evolution simply doesn't fire.
      loadBinaries(`${import.meta.env.BASE_URL}binaries.bin`),
      // IAU constellation boundary arcs + the fade-quantile table. ~334 KB;
      // null when the artifact is missing or invalid (a checkout that never
      // ran `pnpm run build:catalog`). Chart mode then draws no boundaries.
      // Never rejects — inside this Promise.all a rejection blanks the app.
      loadBoundaries(`${import.meta.env.BASE_URL}constellation-boundaries.json`),
      // Only the critical module (star: catalog + search index) can reject
      // out of here — the catch below is the error screen.
      ...loadKindModules(kinds, import.meta.env.BASE_URL, showCatalogProgress),
    ]);
    const catalog = kinds.star.catalog;
    const starLabels = kinds.star.starLabels;

    const webgpu = await webgpuBoot;
    // The probe said supported, so a null here is a device that came back
    // and then refused the renderer — same page, same advice.
    if (webgpu === null) {
      showWebGpuGate('no-adapter');
      return;
    }

    const stellata = new Stellata({ canvas, catalog, kinds, webgpu });
    // Dev-console access: `stellata.setExtinctionStrength(X)` etc. Handy for
    // dust debugging and not worth gating behind an env check on a solo
    // project.
    window.stellata = stellata;
    // IAU constellation boundaries — a chart-only declutter element at floor
    // 'all'; absent artifact = no arcs.
    if (boundaries) stellata.attachConstellationBoundaries(boundaries);

    // Focus-card "Orbiting <host>" breadcrumbs read the same star labels
    // the search corpus shows.
    stellata.kinds.planet.setHostStarNameOf((idx) => starLabels.get(idx) ?? null);

    // Planet Targets carry the body field's flat instance index, which
    // exists only once the attach table populates (a microtask after the
    // constructor) — the search corpus, URL restore, and SID wiring below
    // all read it, so settle it first.
    await stellata.kinds.planet.systemsReady;

    // util/url-state/README.md#legacy-hip-refs.
    const hipToIndex = new Map<number, number>();
    let hipIndexed = 0;
    const indexHips = () => {
      for (; hipIndexed < catalog.loadedCount; hipIndexed++) {
        const h = catalog.hip[hipIndexed];
        if (h > 0 && !hipToIndex.has(h)) hipToIndex.set(h, hipIndexed);
      }
    };
    indexHips();
    // Global SID resolver (/docs/sid.md#8-runtime-resolver-b4). `sun` is not in the planet
    // domain — Sol's catalog record carries the same sid, so the star
    // domain claims it (see util/sid-resolver/README.md).
    const sidResolver = new SidResolver(
      ['star', 'planet', 'cloud', 'lg', 'shell', 'probe'],
      catalog.sidSuccessors,
    );
    // Kind-module domains: sids() is localIndex-ordered with
    // localIndex = Target idx — except the planet domain, keyed
    // body-within-host and translated at the URL boundary (idMaps
    // below). Static lists (planet, shell) attach even when a layer's
    // artifact is absent — focus/pin then fall through to null via the
    // empty registry slot.
    //
    // The STAR domain attaches now but declares itself STILL FILLING, so a
    // hit resolves immediately and only a miss stays pending
    // (util/sid-resolver/README.md#a-domain-that-is-still-filling). That
    // ordering matters beyond latency: with a focus the encoder elides
    // `worldOffset`, so the URL's cam/tgt are in the focal star's local
    // frame — resolving the focus after they are applied puts the camera in
    // the wrong frame and then recentres out from under it.
    for (const kind of KIND_ROSTER) {
      const m = kinds[kind];
      if (!m) continue;
      const sids = m.sids();
      if (!sids) { sidResolver.conclude(kind); continue; }
      sidResolver.attach(kind, kind === 'star'
        ? arrayDomain(sids, () => catalog.loadedCount)
        : arrayDomain(sids));
    }
    // Each landing chunk can claim a queued intent, and a still-filling
    // domain has no attach event of its own to flush on.
    const offChunk = catalog.onRecordsDecoded(() => {
      indexHips();
      sidResolver.refresh();
    });

    const idMaps: IdMaps = {
      hipToIndex,
      indexToHip: catalog.hip,
      starCount: catalog.count,
      solIndex: catalog.solIndex,
      sidResolver,
      // The planet SID domain is keyed planet-within-host with the host
      // implicit (Sol today — wiring map in util/sid-resolver/README.md);
      // Target {kind:'planet'} carries the body field's flat instance
      // index. Translate at the URL boundary in both directions.
      planetDomainIndexOf: (targetIdx) => {
        const host = stellata.kinds.planet.field.hostPlanetOf(targetIdx);
        return host && host.hostStarIdx === catalog.solIndex ? host.planetIdx : null;
      },
      planetTargetIndexOf: (domainIndex) =>
        stellata.kinds.planet.field.instanceIndexOf(catalog.solIndex, domainIndex),
    };

    const debugTools = setupDebug(stellata, idMaps);

    // Interstellar dust loads in the background — never blocks first paint.
    // Extinction fades in as each voxel chunk lands on the GPU. If the
    // manifest is missing (fresh clone without data/dust/, CI without the
    // preprocessor, etc.) the stellata renders exactly as it did before
    // dust was introduced.
    void (async () => {
      const dustBase = `${import.meta.env.BASE_URL}dust/`;
      const manifest = await loadDustManifest(dustBase);
      if (!manifest) {
        console.info('dust manifest not found; skipping extinction layer');
        return;
      }
      const dust = new DustField(stellata.renderer, dustBase, manifest);
      stellata.attachDust(dust);
      await dust.startLoading();
    })();

    bindUnitToggle();
    registerThemeStellata(stellata);
    // Bound in wave 1 over a map filled in wave 2 — README.md#boot-in-two-waves.
    const bayerMap = new Map<number, BayerInfo>();
    bindChartMode(stellata, { bayerMap, starLabels });
    bindControls(stellata);
    createDistanceVectorOverlay(stellata);
    createFocusRingOverlay(stellata);
    createPoiOverlay(stellata);
    createClickRipple(stellata);
    for (const frame of DRAWN_COORD_SPHERE_FRAMES) {
      createCoordSphereLabels(stellata, COORD_SPHERE_SPECS[frame], () =>
        stellata.coordSpheres.drawn(frame) ? 1 : 0);
    }
    createPlanetLabels(stellata);
    // Kind-module SVG label overlays (probe, cloud, lg, shell).
    for (const kind of KIND_ROSTER) kinds[kind]?.labels?.();
    // Milky Way label fades in once the camera sits past ~10 kpc from the
    // galactic centre. Wired outside the lg module — the MW label anchors
    // at GALACTIC_CENTRE_PC, not at a Local Group catalog entry — but it
    // shares that module's apparent-size ranking pass.
    createMilkyWayLabel(stellata);
    createScaleBar(stellata);
    const attitude = createAttitudeIndicator(stellata);
    if (attitude !== null) stellata.setOrbitFrameTick(attitude.tickOrbitFrame);
    bindWarpButton(stellata);
    bindModeToggle(stellata);
    // Hide the #overlay SVG (HUD arrows, focus ring, distance vector,
    // POI labels, etc.) while the focus-park lerp is in flight — same
    // body-class hide pattern the warp uses. CSS selector matches
    // `body.warping` so we don't have to duplicate the rule per source.
    stellata.on('focusLerp', (active) => {
      document.body.classList.toggle('focus-lerping', active);
    });

    // Apply any URL state before starting the URL writer so we don't echo
    // the same params back into history on load. With no `?v=`, fall back
    // to the canonical first-load view (Sol focus, parked at 5 AU aimed at
    // the galactic centre, HUD on, no constellation highlight).
    // Planet-focus refs need the body field's attach table, settled by
    // the kinds.planet.systemsReady await above.
    const { applied, focusPending } = applyFromUrl(stellata, idMaps);
    if (!applied) {
      applyFirstLoadView(stellata, idMaps);
    }
    // Clear this only alongside `scene-live` below — the two decide
    // together whether anything renders over a covered scene.
    let awaitingFocus = focusPending !== null;
    startUrlSync(stellata, idMaps);

    // Bottom-right meta: catalog count + (when focused on a planet host)
    // the live UTC timestamp the planet positions correspond to. The
    // focused-object identity lives in the focus card.
    const countLabel = `${catalog.count.toLocaleString()} stars and objects`;
    const timeScrubber = createTimeScrubberWidget({ meta, stellata, countLabel });

    // Each hover provider mirrors the renderer's "is this drawn?"
    // predicate as its visibility gate — visibility ⇒ hoverable; no
    // focus / mode gates. Provider order is irrelevant.
    const hoverProviders: HoverProvider[] = [];
    for (const kind of KIND_ROSTER) {
      const provider = kinds[kind]?.hover?.();
      if (provider) hoverProviders.push(provider);
    }
    createHoverEngine({
      canvas,
      tooltip,
      initialProviders: hoverProviders,
      onPickImminent: () => stellata.notifyPickImminent(),
      visibility: () => stellata.pickVisibility(),
    });

    // Tier-2 card rolodex (focus card + per-POI cards). Every provider's
    // distance leg reads the local frame (camera and object share it),
    // so the values match what hover's pick paths report.
    createCardRolodex({
      stellata,
      derivedGeneration: () => kinds.star.derivedGeneration(),
      focusPending: () => awaitingFocus,
      providers: {
        star: kinds.star.card(),
        planet: kinds.planet.card(),
        probe: kinds.probe.card(),
        cloud: kinds.cloud.card(),
        lg: kinds.lg.card(),
        shell: kinds.shell.card(),
      },
    });

    // FIRST PAINT. The scene is live on the catalogue's first chunk, so the
    // chrome comes up now and the loading panel stays on top of a rendering
    // sky rather than in front of a blank one.
    // util/url-state/README.md#a-focus-that-resolves-after-the-pose.
    if (focusPending) await Promise.race([focusPending, kinds.star.ready]);
    awaitingFocus = false;
    await new Promise((r) => requestAnimationFrame(r));
    // Out of the root stacking context and into the instrument stack —
    // `.loading` in styles.css.
    document.getElementById('bottom-left-stack')!.prepend(loading);
    document.body.classList.add('scene-live');
    // README.md#boot-in-two-waves the dead-control rule.
    const searchInputs = [
      document.getElementById('search-focus'),
      document.getElementById('search-to'),
    ].filter((el): el is HTMLInputElement => el !== null);
    for (const el of searchInputs) {
      el.disabled = true;
      el.placeholder = 'Loading catalogue…';
    }
    topbar.hidden = false;
    panel.hidden = false;
    brandBox.hidden = false;
    meta.hidden = false;
    bindPanelLayout();
    bindBrandModals(catalog.count);
    bindControlsHideToggle();
    bindKeyboardShortcuts(stellata, {
      levelAttitude: () => attitude?.level(),
      cycleReferenceFrame: () => attitude?.cycleFrame(),
      aimAtFrameOrigin: (opposite) => attitude?.aimAtFrameOrigin(opposite),
      toggleOrbitLock: () => attitude?.toggleOrbitLock(),
      toggleDebugPanel: debugTools.panel,
      timeScrubber,
    });

    // WAVE 2. Everything that needs the COMPLETE record set, or the search
    // index that rides beside it. Each entry here is a correctness
    // requirement, not a tidiness one — see the comment at each call.
    await kinds.star.ready;
    const completeCatalog = await catalog.whenComplete;
    const searchIndex = kinds.star.searchIndex;
    await frame();

    // The column is full, so the domain now answers `unknown` for a sid
    // nothing carries instead of holding its intent open forever.
    offChunk();
    indexHips();
    sidResolver.refresh();
    await frame();

    // Relation caches bake each system's anchor from its primary's
    // position, and `relationIndicesInBounds` tests against the full
    // allocation — so a pair in a late chunk would cache (0,0,0) as its
    // anchor and project the whole orbit in the wrong frame, silently.
    stellata.binaries.attach(binaries);
    await frame();

    // Chart mode bound against this map in wave 1 and holds it by
    // reference (README.md#boot-in-two-waves), so fill it, never swap it.
    const searchTables = kinds.star.searchTables;
    for (const [idx, info] of searchTables.bayer) bayerMap.set(idx, info);
    await frame();
    bindSearch(stellata, completeCatalog, searchIndex, searchTables.corpus);
    bindFindSearch(stellata, completeCatalog, searchIndex, searchTables.corpus);
    for (const el of searchInputs) {
      el.disabled = false;
      el.placeholder = el.id === 'search-to' ? 'Search destination…' : 'Search stars…';
    }
    await frame();

    loading.style.transition = 'opacity 0.4s ease';
    loading.style.opacity = '0';
    setTimeout(() => {
      loading.remove();
      // On a bare touch device the mobile advisory takes the one splash
      // slot; otherwise the welcome modal shows as usual.
      if (!maybeShowMobileAdvisory()) {
        maybeShowInfoModal(catalog.count);
      }
    }, 400);

  } catch (err) {
    console.error(err);
    loadingStatus.textContent = `Error: ${(err as Error).message}`;
  }
}

main();
