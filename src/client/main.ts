import { loadCatalog } from './loaders/catalog-loader';
import { CATALOG_MANIFEST_FILENAME } from '../../scripts/catalog/catalog-pure';
import { DustField, loadDustManifest, loadDustParticles } from './loaders/dust-loader';
import { loadClouds } from './molecular-clouds/cloud-loader';
import { loadCloudSurfaces } from './molecular-clouds/cloud-surfaces-loader';
import { createMolecularCloudLabels } from './molecular-clouds/cloud-labels';
import { loadLocalGroup } from './local-group/local-group-loader';
import { loadBinaries } from './binaries/binaries-loader';
import { loadLocalBubble } from './local-bubble/local-bubble-loader';
import { loadBoundaries } from './constellation-boundaries/boundary-artifact-loader';
import { createLocalBubbleLabel } from './local-bubble/local-bubble';
import { createLocalGroupLabels, createMilkyWayLabel } from './local-group/local-group';
import { Stellata } from './stellata';
import { bindControls } from './camera/controls/controls';
import { bindSearch, bindFindSearch, buildStarLabels, buildSpectralMap, buildBayerMap, type SearchEntry } from './typeahead/search';
import { createDistanceVectorOverlay } from './overlays/distance-vector-overlay';
import { createFocusRingOverlay } from './overlays/focus-ring-overlay';
import { createPoiOverlay } from './overlays/poi-overlay';
import { createClickRipple } from './overlays/click-ripple';
import { createPlanetLabels } from './solar-system/planets/planet-labels';
import { loadPlanetElementTables } from './solar-system/ephemerides/element-table-loader';
import { buildKindModules, KIND_ROSTER } from './kinds/kind-modules';
import { createHeliopauseLabel } from './solar-system/heliopause/heliopause';
import { createScaleBar } from './ui/scale-bar';
import { createTimeScrubberWidget } from './solar-system/time/time-scrubber-widget';
import { tToJDE } from './solar-system/time/time';
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
import { SidResolver, arrayDomain } from './util/sid-resolver';
import { SOL_OBJECT_SIDS } from './solar-system/sol-object-sids';
import { moonNamesOf, SOL_BODIES } from './solar-system/planet-system';
import { applyFirstLoadView } from './solar-system/first-load';
import { setupDebug } from './debug/debug';
import { createHoverEngine } from './hover/hover-engine';
import { createCardRolodex } from './focus-card/card-rolodex';
import { createStarFocusProvider } from './focus-card/star-focus-provider';
import { createPlanetFocusProvider } from './focus-card/planet-focus-provider';
import { orbitDescriptorFor } from './solar-system/ephemerides/orbit-descriptor';
import { createCloudFocusProvider } from './focus-card/cloud-focus-provider';
import { createLgFocusProvider } from './focus-card/lg-focus-provider';
import { createShellFocusProvider } from './focus-card/shell-focus-provider';
import { SHELL_OBJECT_SIDS } from './fresnel-shell/shell-object-sids';
import { SHELL_KEYS } from './fresnel-shell/shell-registry';
import { createStarHoverProvider } from './hover/star-hover-provider';
import { createPlanetHoverProvider } from './hover/planet-hover-provider';
import { createLocalGroupHoverProvider } from './hover/local-group-hover-provider';
import { createShellHoverProvider } from './hover/shell-hover-provider';
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
    const kinds = buildKindModules();
    const [catalog, searchIndex, cloudCatalog, cloudSurfaces, lgCatalog, binaries, localBubble, boundaries] = await Promise.all([
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
      // Per-cloud isosurface rim meshes; null if the artifact is missing —
      // every cloud then falls back to its ellipsoid rim shape.
      loadCloudSurfaces(`${import.meta.env.BASE_URL}cloud-surfaces.bin`),
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
      // Local Bubble shell mesh. ~650 KB; null when the artifact is
      // missing (fresh checkout without `pnpm run build:local-bubble`).
      // The scene renders fine without it — the shell simply doesn't draw.
      loadLocalBubble(`${import.meta.env.BASE_URL}local-bubble.bin`),
      // IAU constellation boundary arcs + the fade-quantile table. ~334 KB;
      // null when the artifact is missing or invalid (a checkout that never
      // ran `pnpm run build:catalog`). Chart mode then draws no boundaries.
      // Never rejects — inside this Promise.all a rejection blanks the app.
      loadBoundaries(`${import.meta.env.BASE_URL}constellation-boundaries.json`),
      // Kind-module artifacts (deep-space probes today). Each load never
      // rejects — a missing artifact leaves that kind's roster empty.
      ...KIND_ROSTER.map((kind) => kinds[kind]?.load(import.meta.env.BASE_URL)),
    ]);

    loadingStatus.textContent = `Parsed ${catalog.count.toLocaleString()} stars`;
    loadingBar.style.width = '100%';

    const starLabels = buildStarLabels(catalog, searchIndex);
    const spectralMap = buildSpectralMap(searchIndex);
    const bayerMap = buildBayerMap(searchIndex);

    const stellata = new Stellata({ canvas, catalog, kinds });
    // Dev-console access: `stellata.setExtinctionStrength(X)` etc. Handy for
    // dust debugging and not worth gating behind an env check on a solo
    // project.
    window.stellata = stellata;
    // Molecular-cloud presence layer — a representational-tier declutter
    // element; absent artifact = no layer.
    if (cloudCatalog) stellata.attachClouds(cloudCatalog, cloudSurfaces);

    // Local Group wireframes. Always-on when the artifact is present —
    // same model as the MW disc, no toggle / URL flag.
    if (lgCatalog) stellata.attachLocalGroup(lgCatalog);

    // Binary-orbit runtime — visible orbital motion for ~hundreds of
    // catalog pairs against `Stellata.getT()`. Static placements remain
    // identical when this artifact is absent.
    if (binaries) stellata.attachBinaries(binaries);

    // Local Bubble shell — the dust-wall cavity the Sun sits inside.
    // A representational declutter element; absent artifact = no shell.
    if (localBubble) stellata.attachLocalBubble(localBubble);

    // IAU constellation boundaries — a chart-only declutter element at floor
    // 'all'; absent artifact = no arcs.
    if (boundaries) stellata.attachConstellationBoundaries(boundaries);

    // Horizons planet element tables — 1.5 MB that upgrades the planet
    // ephemeris from the Standish series' 0.06 AU to ~5e-6 AU across
    // 1900–2100. Deliberately not awaited: the first frame is Sol-focused,
    // where the outer planets the tables move are sub-pixel discs, so paying
    // for it before first paint would buy nothing visible.
    void loadPlanetElementTables(import.meta.env.BASE_URL);

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
    // claims it (see util/sid-resolver/README.md). The planet domain is
    // keyed body-within-host over SOL_BODIES (planets then moons), so a
    // moon's sid sits at its body index and resolves like any planet.
    const sidResolver = new SidResolver(
      ['star', 'planet', 'cloud', 'lg', 'shell', 'probe'],
      catalog.sidSuccessors,
    );
    sidResolver.attach('star', arrayDomain(catalog.sid));
    sidResolver.attach(
      'planet',
      arrayDomain(SOL_BODIES.map((p) => SOL_OBJECT_SIDS[p.name.toLowerCase()] ?? 0)),
    );
    if (cloudCatalog) sidResolver.attach('cloud', arrayDomain(cloudCatalog.clouds.map((c) => c.sid)));
    else sidResolver.conclude('cloud');
    if (lgCatalog) sidResolver.attach('lg', arrayDomain(lgCatalog.objects.map((o) => o.sid)));
    else sidResolver.conclude('lg');
    // Both boundary shells carry static, always-known SIDs (generated /
    // curated objects, docs/sid.md § 7). localIndex = SHELL_KEYS index =
    // Target {kind:'shell'} idx. Attach unconditionally: a shell whose
    // layer is absent still resolves its sid, then focus/pin fall through
    // to null via the shell provider's legs (same graceful path as lg).
    sidResolver.attach('shell', arrayDomain(SHELL_KEYS.map((k) => SHELL_OBJECT_SIDS[k])));
    // Kind-module domains (probes today): sids() is localIndex-ordered
    // with localIndex = Target idx; null concludes the domain.
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
        const host = stellata.planetField.hostPlanetOf(targetIdx);
        return host && host.hostStarIdx === catalog.solIndex ? host.planetIdx : null;
      },
      planetTargetIndexOf: (domainIndex) =>
        stellata.planetField.instanceIndexOf(catalog.solIndex, domainIndex),
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
    bindSearch(stellata, catalog, searchIndex, starLabels, cloudCatalog, lgCatalog);
    bindFindSearch(stellata, catalog, searchIndex, cloudCatalog, lgCatalog);
    createDistanceVectorOverlay(stellata, starLabels);
    createFocusRingOverlay(stellata);
    createPoiOverlay(stellata, starLabels);
    createClickRipple(stellata);
    for (const frame of DRAWN_COORD_SPHERE_FRAMES) {
      createCoordSphereLabels(stellata, COORD_SPHERE_SPECS[frame], () =>
        stellata.getFilter().coordSphere === frame ? stellata.coordSphereFade(frame) : 0);
    }
    createPlanetLabels(stellata);
    // Kind-module SVG label overlays (probe labels today).
    for (const kind of KIND_ROSTER) kinds[kind]?.labels?.();
    createHeliopauseLabel(stellata);
    createLocalBubbleLabel(stellata);
    // Per-cloud molecular-cloud labels. Mints SVG <text> children under
    // #cloud-labels; no-op when the cloud layer didn't attach.
    createMolecularCloudLabels(stellata);
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
    // Planet-focus refs resolve through the body field's attach table,
    // which populates on a microtask — settle it first.
    await stellata.planetSystemsReady;
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
    const starHoverProvider = createStarHoverProvider({
      stellata,
      context: {
        starLabels,
        gaiaSourceId: catalog.gaiaSourceId,
        sid: catalog.sid,
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
    // Boundary-shell hover dispatches over the shell registry — one
    // provider covers the Local Bubble and the heliopause alike.
    const shellHoverProvider = createShellHoverProvider({ stellata });
    const hoverProviders: HoverProvider[] = [
      starHoverProvider,
      planetHoverProvider,
      shellHoverProvider,
    ];
    // Kind-module hover surfaces (probes today).
    for (const kind of KIND_ROSTER) {
      const provider = kinds[kind]?.hover?.();
      if (provider) hoverProviders.push(provider);
    }
    // LG provider only registers when the build artifact loaded — fresh
    // checkouts without `pnpm run build:local-group` leave stellata.localGroup
    // null and the wireframes don't render; no provider in that case.
    if (lgCatalog) {
      hoverProviders.push(createLocalGroupHoverProvider({
        stellata,
        context: { objects: lgCatalog.objects },
      }));
    }
    // Cloud provider registers iff the cloud layer is attached (absent
    // clouds.json artifact = no layer, no provider).
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

    // Tier-2 card rolodex (focus card + per-POI cards). Both distance
    // functions read the local frame (camera and object share it), so
    // the values match what hover's pick paths report.
    const searchEntries = new Map(searchIndex.map((e) => [e.i, e]));
    const starFocusProvider = createStarFocusProvider({
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
    });
    createCardRolodex({
      stellata,
      providers: {
        star: starFocusProvider,
        planet: createPlanetFocusProvider({
          planetAt: (idx) => stellata.planetField.planetAt(idx),
          orbitDescriptorOf: (idx) => {
            const planet = stellata.planetField.planetAt(idx);
            const host = stellata.planetField.hostPlanetOf(idx);
            if (!planet || !host) return null;
            const ps = stellata.planetField.getAttachedPlanetSystem(host.hostStarIdx);
            if (!ps) return null;
            return orbitDescriptorFor(planet, ps, starLabels.get(host.hostStarIdx) ?? null);
          },
          cameraDistancePc: (idx) => stellata.planetCameraDistancePc(idx),
          appMagFor: (idx) =>
            stellata.planetField.appMagForInstance(idx, stellata.camera.position),
          constellationName: (idx) => stellata.constellationOf('planet', idx),
          moonNamesOf: (idx) => {
            const host = stellata.planetField.hostPlanetOf(idx);
            const ps = host
              ? stellata.planetField.getAttachedPlanetSystem(host.hostStarIdx)
              : null;
            return ps ? moonNamesOf(ps.planets, host!.planetIdx) : [];
          },
        }),
        probe: kinds.probe.card(),
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
          constellationName: (idx) => stellata.constellationOf('cloud', idx),
        }),
        lg: createLgFocusProvider({
          objects: lgCatalog?.objects ?? null,
          cameraDistancePc: (idx) => {
            const obj = lgCatalog!.objects[idx];
            const w = stellata.getWorldOffset();
            const c = stellata.camera.position;
            return Math.hypot(
              obj.centerAbs.x - w.x - c.x,
              obj.centerAbs.y - w.y - c.y,
              obj.centerAbs.z - w.z - c.z,
            );
          },
          constellationName: (idx) => stellata.constellationOf('lg', idx),
        }),
        shell: createShellFocusProvider({
          shellAt: (idx) => stellata.shells.at(idx),
          cameraDistancePc: (idx) =>
            stellata.shells.cameraDistancePc(idx, stellata.getWorldOffset(), stellata.camera.position),
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
      bindBrandModals(catalog.count);
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
