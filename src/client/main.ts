import { loadCatalog } from './loaders/catalog-loader';
import { CATALOG_MANIFEST_FILENAME } from '../../scripts/catalog/catalog-pure';
import { DustField, loadDustManifest, loadDustParticles } from './loaders/dust-loader';
import { loadClouds } from './molecular-clouds/cloud-loader';
import { loadLocalGroup } from './local-group/local-group-loader';
import { loadBinaries } from './binaries/binaries-loader';
import { createLocalGroupLabels, createMilkyWayLabel } from './local-group/local-group';
import { Stellata } from './stellata';
import { bindControls } from './camera/controls/controls';
import { bindSearch, bindFindSearch, buildStarLabels, buildSpectralMap, buildBayerMap, type SearchEntry } from './typeahead/search';
import { createConstellationOverlay } from './overlays/constellation-overlay';
import { createDiscMask } from './overlays/disc-mask';
import { createDistanceVectorOverlay } from './overlays/distance-vector-overlay';
import { createFocusRingOverlay } from './overlays/focus-ring-overlay';
import { createPoiOverlay } from './overlays/poi-overlay';
import { createClickRipple } from './overlays/click-ripple';
import { createPlanetLabels } from './solar-system/planet-labels';
import { createHeliopauseLabel } from './solar-system/heliopause';
import { createScaleBar } from './ui/scale-bar';
import { createTimeScrubberWidget } from './solar-system/time-scrubber-widget';
import { tToJDE } from './solar-system/time';
import { bindUnitToggle } from './ui/unit-toggle';
import { createGalacticGridLabels } from './galactic/galactic-grid-labels';
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
import { SidResolver, arrayDomain } from './util/sid-resolver';
import { SOL_OBJECT_SIDS } from './solar-system/sol-object-sids';
import { SOL_PLANETS } from './solar-system/planet-system';
import { applyFirstLoadView } from './solar-system/first-load';
import { setupDebug } from './debug/debug';
import { createHoverEngine } from './hover/hover-engine';
import { createFocusCard } from './focus-card/focus-card';
import { createStarFocusProvider } from './focus-card/star-focus-provider';
import { createCloudFocusProvider } from './focus-card/cloud-focus-provider';
import { createStarHoverProvider } from './hover/star-hover-provider';
import { createPlanetHoverProvider } from './hover/planet-hover-provider';
import { createLocalGroupHoverProvider } from './hover/local-group-hover-provider';
import { createHeliopauseHoverProvider } from './hover/heliopause-hover-provider';
import { createCloudHoverProvider } from './hover/cloud-hover-provider';
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

  try {
    const [catalog, searchIndex, cloudCatalog, lgCatalog, binaries] = await Promise.all([
      loadCatalog(
        `${import.meta.env.BASE_URL}${CATALOG_MANIFEST_FILENAME}`,
        `${import.meta.env.BASE_URL}constellations.json`,
        ({ bytes, total }) => {
          const pct = (bytes / total) * 100;
          loadingBar.style.width = pct.toFixed(0) + '%';
          loadingStatus.textContent = `${(bytes / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`;
        },
      ),
      fetch(`${import.meta.env.BASE_URL}search-index.json`).then(
        (r) => r.json() as Promise<SearchEntry[]>,
      ),
      // Molecular clouds. Fetched in parallel with the catalog —
      // a few hundred KB; null if the artifact is missing (fresh checkout
      // without `pnpm run build:clouds`).
      loadClouds(`${import.meta.env.BASE_URL}clouds.json`),
      // Local Group wireframes. ~20 KB JSON; null if
      // the artifact is missing (fresh checkout without
      // `pnpm run build:local-group`). No-op layer in that case —
      // outlines simply don't render.
      loadLocalGroup(`${import.meta.env.BASE_URL}local-group.json`),
      // Binary / multiple-star orbital elements. ~64 KB; null when the
      // artifact is missing (fresh checkout without
      // `pnpm run build:binaries`). The renderer renders identically
      // without the field; orbital evolution simply doesn't fire.
      loadBinaries(`${import.meta.env.BASE_URL}binaries.bin`),
    ]);

    loadingStatus.textContent = `Parsed ${catalog.count.toLocaleString()} stars`;
    loadingBar.style.width = '100%';

    const starLabels = buildStarLabels(catalog, searchIndex);
    const spectralMap = buildSpectralMap(searchIndex);
    const bayerMap = buildBayerMap(searchIndex);

    const stellata = new Stellata({ canvas, catalog });
    // Dev-console access: `stellata.setExtinctionStrength(X)` etc. Handy for
    // dust debugging and not worth gating behind an env check on a solo
    // project.
    window.stellata = stellata;
    // Cloud layer is currently shelved (CLAUDE.md). The fetch and parsing
    // stay so the machinery is verified; the attach is suppressed so the
    // layer doesn't enter the scene. Re-enable by uncommenting the line
    // below AND attaching the 'cloud' SID domain in place of the
    // conclude('cloud') call further down.
    // if (cloudCatalog) stellata.attachClouds(cloudCatalog);

    // Local Group wireframes. Always-on when the artifact is present —
    // same model as the MW disc, no toggle / URL flag.
    if (lgCatalog) stellata.attachLocalGroup(lgCatalog);

    // Binary-orbit runtime — visible orbital motion for ~hundreds of
    // catalog pairs against `Stellata.getT()`. Static placements remain
    // identical when this artifact is absent.
    if (binaries) stellata.attachBinaries(binaries);

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
    const sidResolver = new SidResolver(['star', 'planet', 'cloud', 'lg']);
    sidResolver.attach('star', arrayDomain(catalog.sid));
    sidResolver.attach(
      'planet',
      arrayDomain(SOL_PLANETS.map((p) => SOL_OBJECT_SIDS[p.name.toLowerCase()] ?? 0)),
    );
    sidResolver.conclude('cloud');
    if (lgCatalog) sidResolver.attach('lg', arrayDomain(lgCatalog.objects.map((o) => o.sid)));
    else sidResolver.conclude('lg');

    const idMaps: IdMaps = {
      hipToIndex,
      indexToHip: catalog.hip,
      starCount: catalog.count,
      solIndex: catalog.solIndex,
      sidResolver,
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
    // null cloudCatalog: cloud layer is currently shelved (CLAUDE.md), so
    // search shouldn't surface unreachable cloud entries. Pass
    // `cloudCatalog` directly when re-enabling.
    bindSearch(stellata, catalog, searchIndex, starLabels, null);
    bindFindSearch(stellata, catalog, searchIndex, null);
    createDiscMask(stellata);
    createConstellationOverlay(stellata);
    createDistanceVectorOverlay(stellata, starLabels);
    createFocusRingOverlay(stellata);
    createPoiOverlay(stellata, starLabels);
    createClickRipple(stellata);
    createGalacticGridLabels(stellata);
    createPlanetLabels(stellata);
    createHeliopauseLabel(stellata);
    // Milky Way label fades in once the camera sits past ~10 kpc from the
    // galactic centre. Independent of attachLocalGroup — the MW label
    // anchors at GALACTIC_CENTRE_PC, not at a Local Group catalog entry.
    createMilkyWayLabel(stellata);
    // Per-object Local Group labels. Mints SVG <text> children under
    // #lg-labels for each catalog object that carries a labelThresholdPc;
    // no-op when the layer didn't attach (missing artifact).
    if (stellata.localGroup) createLocalGroupLabels(stellata, stellata.localGroup);
    createScaleBar(stellata);
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
    if (!applyFromUrl(stellata, idMaps)) {
      applyFirstLoadView(stellata, idMaps);
    }
    startUrlSync(stellata, idMaps);

    // Bottom-right meta: catalog count + (when focused on a planet host)
    // the live UTC timestamp the planet positions correspond to. The
    // focused-object identity lives in the focus card.
    const countLabel = `${catalog.count.toLocaleString()} stars`;
    const timeScrubber = createTimeScrubberWidget({ meta, stellata, countLabel });

    // Each hover provider mirrors the renderer's "is this drawn?"
    // predicate as its visibility gate — visibility ⇒ hoverable; no
    // focus / mode gates. Provider order is irrelevant.
    const starHoverProvider = createStarHoverProvider({
      stellata,
      context: {
        starLabels,
        spectralMap,
        spectClass: catalog.spectClass,
        luminosityClass: catalog.luminosityClass,
        flags: catalog.flags,
        constellation: catalog.constellation,
        constellations: catalog.constellations,
        periodDays: catalog.periodDays,
        amplitudeMag: catalog.amplitudeMag,
        binaries,
      },
    });
    const planetHoverProvider = createPlanetHoverProvider({ stellata });
    const heliopauseHoverProvider = createHeliopauseHoverProvider({ stellata });
    const hoverProviders: HoverProvider[] = [
      starHoverProvider,
      planetHoverProvider,
      heliopauseHoverProvider,
    ];
    // LG provider only registers when the build artifact loaded — fresh
    // checkouts without `pnpm run build:local-group` leave stellata.localGroup
    // null and the wireframes don't render; no provider in that case.
    if (lgCatalog) {
      hoverProviders.push(createLocalGroupHoverProvider({
        stellata,
        context: { objects: lgCatalog.objects },
      }));
    }
    // Cloud provider registers iff the cloud layer is attached. The
    // attach call is currently shelved (CLAUDE.md), so this branch is
    // unreached in shipping builds — un-shelving (uncommenting the
    // `attachClouds(cloudCatalog)` line above) auto-registers the
    // provider with no further wiring. The formatter and provider class
    // ship anyway so the un-shelve diff is one line, not a re-implement.
    if (stellata.cloudLayer) {
      hoverProviders.push(createCloudHoverProvider({
        stellata,
        context: { clouds: stellata.cloudLayer.clouds },
      }));
    }
    createHoverEngine({
      canvas,
      tooltip,
      initialProviders: hoverProviders,
    });

    // Tier-2 focus card. Both distance functions read the local frame
    // (camera and object share it), so the values match what hover's
    // pick paths report.
    const searchEntries = new Map(searchIndex.map((e) => [e.i, e]));
    createFocusCard({
      stellata,
      providers: {
        star: createStarFocusProvider({
          catalog,
          starLabels,
          spectralMap,
          searchEntries,
          binaries,
          cameraDistancePc: (idx) => {
            const lp = stellata.localPositions;
            const c = stellata.camera.position;
            return Math.hypot(lp[idx * 3] - c.x, lp[idx * 3 + 1] - c.y, lp[idx * 3 + 2] - c.z);
          },
          nowJd: () => tToJDE(stellata.getT()),
        }),
        cloud: createCloudFocusProvider({
          clouds: cloudCatalog?.clouds ?? null,
          cameraDistancePc: (idx) => {
            const cloud = cloudCatalog!.clouds[idx];
            const w = stellata.getWorldOffset();
            const c = stellata.camera.position;
            return Math.hypot(
              cloud.centerAbs.x - w.x - c.x,
              cloud.centerAbs.y - w.y - c.y,
              cloud.centerAbs.z - w.z - c.z,
            );
          },
        }),
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
      bindBrandModals();
      bindControlsHideToggle();
      bindKeyboardShortcuts(stellata, {
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
