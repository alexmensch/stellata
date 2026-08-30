import { DustField, loadDustManifest, loadDustParticles } from './loaders/dust-loader';
import { loadBinaries } from './binaries/binaries-loader';
import { loadBoundaries } from './constellation-boundaries/boundary-artifact-loader';
import { createMilkyWayLabel } from './local-group/local-group';
import { Stellata } from './stellata';
import { bindControls } from './camera/controls/controls';
import { bindSearch, bindFindSearch } from './typeahead/search';
import { buildBayerMap } from './typeahead/star-name-tables';
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
import { parseGateOverride, parseRendererFlag } from './webgpu/renderer-flag';
import { showWebGpuGate } from './webgpu/gate/gate-page';
import { SidResolver, arrayDomain } from './util/sid-resolver';
import { applyFirstLoadView } from './solar-system/first-load';
import { setupDebug } from './debug/debug';
import { createHoverEngine } from './hover/hover-engine';
import { createCardRolodex } from './focus-card/card-rolodex';
import type { HoverProvider } from './hover/hover-types';

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

  // Byte progress of the critical artifact — the star catalog is the
  // only download first paint waits on.
  const showCatalogProgress = ({ bytes, total }: KindLoadProgress) => {
    loadingBar.style.width = `${((bytes / total) * 100).toFixed(0)}%`;
    loadingStatus.textContent =
      `${(bytes / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`;
  };

  // The requires-WebGPU gate, dark until the cutover: WebGL2 is still the
  // default, so nothing reaches this but the dev switch. The cutover is
  // what puts it on a real capability verdict rather than this override
  // (webgpu/gate/README.md § Lands dark). Ahead of the catalog fetch so a
  // gated browser downloads nothing it cannot use.
  const forcedGate = parseGateOverride(location.hash);
  if (forcedGate !== null) {
    showWebGpuGate(forcedGate);
    return;
  }

  try {
    const kinds = buildKindModules();
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
      // Kind-module artifacts. Only the critical module (star: catalog +
      // search index) can reject out of here — the catch below is the
      // error screen.
      ...loadKindModules(kinds, import.meta.env.BASE_URL, showCatalogProgress),
    ]);
    const catalog = kinds.star.catalog;
    const searchIndex = kinds.star.searchIndex;
    const starLabels = kinds.star.starLabels;

    loadingStatus.textContent = `Parsed ${catalog.count.toLocaleString()} stars`;
    loadingBar.style.width = '100%';

    // Chart-mode's Greek-letter labels are the one search-index
    // derivation no kind module consumes.
    const bayerMap = buildBayerMap(searchIndex);

    // The dynamic import is the bundle boundary: webgpu/README.md
    // § Import boundary.
    let webgpu = null;
    if (parseRendererFlag(location.hash) === 'webgpu') {
      const { bootWebGpu } = await import('./webgpu/boot-webgpu');
      webgpu = await bootWebGpu(canvas);
      if (webgpu === null) {
        console.warn('WebGPU unavailable — booting the WebGL2 renderer instead');
      }
    }

    const stellata = new Stellata({ canvas, catalog, kinds, webgpu });
    // Dev-console access: `stellata.setExtinctionStrength(X)` etc. Handy for
    // dust debugging and not worth gating behind an env check on a solo
    // project.
    window.stellata = stellata;
    // Binary-orbit runtime — visible orbital motion for ~hundreds of
    // catalog pairs against `Stellata.getT()`. Static placements remain
    // identical when this artifact is absent.
    if (binaries) stellata.attachBinaries(binaries);

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

    // HIP → row-index lookup, used by url-state to encode/decode shared
    // links with stable star IDs that survive a future catalog reorder.
    // Built once over `catalog.hip` (uint32 per row, 0 = no HIP). First-
    // seen wins on collision (matches Stellarium-figure HIP resolution).
    const hipToIndex = new Map<number, number>();
    for (let i = 0; i < catalog.count; i++) {
      const h = catalog.hip[i];
      if (h > 0 && !hipToIndex.has(h)) hipToIndex.set(h, i);
    }
    // Global SID resolver (docs/sid.md § 8). Every domain this client can
    // attach settles here at boot; `pending` is only reachable for a
    // future genuinely-async domain. `sun` is not in the planet domain —
    // Sol's catalog record carries the same sid, so the star domain
    // claims it (see util/sid-resolver/README.md).
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
    for (const kind of KIND_ROSTER) {
      const m = kinds[kind];
      if (!m) continue;
      const sids = m.sids();
      if (sids) sidResolver.attach(kind, arrayDomain(sids));
      else sidResolver.conclude(kind);
    }

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
      // Particles are lazy — the shelved layer's ~800 KiB fetch fires
      // only on the first console opt-in (setParticleStrength > 0).
      if (manifest.particles) {
        const particlesMeta = manifest.particles;
        stellata.setDustParticleSource(() => loadDustParticles(dustBase, particlesMeta));
      }
      await dust.startLoading();
    })();

    bindUnitToggle();
    registerThemeStellata(stellata);
    bindChartMode(stellata, { bayerMap, starLabels });
    bindControls(stellata);
    bindSearch(stellata, catalog, searchIndex);
    bindFindSearch(stellata, catalog, searchIndex);
    createDistanceVectorOverlay(stellata);
    createFocusRingOverlay(stellata);
    createPoiOverlay(stellata);
    createClickRipple(stellata);
    for (const frame of DRAWN_COORD_SPHERE_FRAMES) {
      createCoordSphereLabels(stellata, COORD_SPHERE_SPECS[frame], () =>
        stellata.filters.getFilter().coordSphere === frame ? stellata.coordSphereFade(frame) : 0);
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
    if (!applyFromUrl(stellata, idMaps)) {
      applyFirstLoadView(stellata, idMaps);
    }
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
    });

    // Tier-2 card rolodex (focus card + per-POI cards). Every provider's
    // distance leg reads the local frame (camera and object share it),
    // so the values match what hover's pick paths report.
    createCardRolodex({
      stellata,
      providers: {
        star: kinds.star.card(),
        planet: kinds.planet.card(),
        probe: kinds.probe.card(),
        cloud: kinds.cloud.card(),
        lg: kinds.lg.card(),
        shell: kinds.shell.card(),
      },
    });

    await new Promise((r) => requestAnimationFrame(r));
    loading.style.transition = 'opacity 0.4s ease';
    loading.style.opacity = '0';
    setTimeout(() => {
      loading.remove();
      topbar.hidden = false;
      panel.hidden = false;
      brandBox.hidden = false;
      meta.hidden = false;
      bindPanelLayout();
      bindBrandModals(catalog.count);
      bindControlsHideToggle();
      bindKeyboardShortcuts(stellata, {
        levelAttitude: () => attitude?.level(),
        toggleDebugPanel: debugTools.panel,
        timeScrubber,
      });
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
