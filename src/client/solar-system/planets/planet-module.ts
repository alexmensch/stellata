// The planet ObjectKindModule — load/attach, the boot-time host-attach
// lifecycle, and every capability leg of the planet kind. See ./README.md.

import * as THREE from 'three';
import type { FocusableProvider } from '../../camera/focus/focus-target';
import * as starPhysics from '../../camera/controls/star-physics';
import { createPlanetFocusProvider } from '../../focus-card/planet-focus-provider';
import type { FocusCardProvider } from '../../focus-card/focus-card-types';
import { formatPlanetHover } from '../../hover/formatters/planet-hover-format';
import type { HoverProvider } from '../../hover/hover-types';
import type {
  KindContext,
  KindPick,
  KindSearchEntry,
  ObjectKindModule,
} from '../../kinds/kind-module';
import type { SceneLayer } from '../../scene/scene-layer';
import { KM_PC } from '../../util/astronomy-constants';
import { loadPlanetElementTables } from '../ephemerides/element-table-loader';
import {
  orbitDescriptorFor,
  type OrbitDescriptor,
} from '../ephemerides/orbit-descriptor';
import {
  getPlanetSystem,
  moonNamesOf,
  SOL_BODIES,
  type PlanetSystem,
} from '../planet-system';
import { SOL_OBJECT_SIDS } from '../sol-object-sids';
import { PlanetBodyField } from './planet-body-field';
import { PlanetMeshLayer } from './planet-mesh-layer';

export interface PlanetKindModule extends ObjectKindModule<'planet'> {
  /** The global body field — Target {kind:'planet'} identity plus the
   *  per-body geometry the shell's cross-kind wiring reads (solar-system
   *  cluster, system membership, URL id maps). Valid after `attach`. */
  readonly field: PlanetBodyField;
  /** Close-range spheroid mesh LOD. The shell updates it AFTER the
   *  moving-focal ride (a pre-ride camera read mis-sizes the focused
   *  body under fast scrub) and parents its group into the local depth
   *  pass via the solar-system cluster. Valid after `attach`. */
  readonly meshLayer: PlanetMeshLayer;
  /** Resolves once the boot-time host attach (Sol) has populated the
   *  field's attach table — it lands on a microtask after `attach`, so
   *  URL planet-focus restore and the search-corpus build await it. */
  readonly systemsReady: Promise<void>;
  /** Host-star display name for the focus card's "Orbiting <host>"
   *  breadcrumb. Search-corpus labels live in main.ts, not on any
   *  KindContext leg, so boot injects the lookup here. */
  setHostStarNameOf(fn: (starIdx: number) => string | null): void;
}

export function createPlanetKindModule(): PlanetKindModule {
  let baseUrl = '';
  let ctx: KindContext | null = null;
  let field: PlanetBodyField | null = null;
  let meshLayer: PlanetMeshLayer | null = null;
  let hostStarNameOf: (starIdx: number) => string | null = () => null;
  let resolveSystemsReady: () => void;
  const systemsReady = new Promise<void>((resolve) => {
    resolveSystemsReady = resolve;
  });
  const tmpLocal = new THREE.Vector3();

  const planetRadiusPc = (idx: number): number | null => {
    const p = field?.planetAt(idx) ?? null;
    return p ? p.radiusKm * KM_PC : null;
  };

  /** Flat instance index → its host's attach-table entry and cached
   *  PlanetSystem; null when no attached host covers the index. */
  const attachedHostOf = (
    idx: number,
  ): { host: { hostStarIdx: number; planetIdx: number }; ps: PlanetSystem } | null => {
    const host = field?.hostPlanetOf(idx) ?? null;
    const ps = host !== null ? field!.getAttachedPlanetSystem(host.hostStarIdx) : null;
    return host !== null && ps !== null ? { host, ps } : null;
  };

  const orbitDescriptorOf = (idx: number): OrbitDescriptor | null => {
    const planet = field?.planetAt(idx) ?? null;
    const attached = attachedHostOf(idx);
    if (planet === null || attached === null) return null;
    return orbitDescriptorFor(planet, attached.ps, hostStarNameOf(attached.host.hostStarIdx));
  };

  // The returned hit's idx is the field's FLAT instance index — the
  // Target {kind:'planet'} currency the click FSM and hover engine both
  // consume — not the body-within-host index `field.pick` reports.
  const pick: KindPick = (clientX, clientY, pixelThreshold) => {
    if (!ctx || !field) return null;
    const rect = ctx.canvas.getBoundingClientRect();
    const hit = field.pick(ctx.camera, rect, clientX, clientY, pixelThreshold);
    if (hit === null || hit.hostStarIdx === undefined) return null;
    const flat = field.instanceIndexOf(hit.hostStarIdx, hit.idx);
    if (flat === null) return null;
    return { ...hit, idx: flat };
  };

  return {
    kind: 'planet',

    get field(): PlanetBodyField {
      if (!field) throw new Error('planet module read before attach');
      return field;
    },
    get meshLayer(): PlanetMeshLayer {
      if (!meshLayer) throw new Error('planet module read before attach');
      return meshLayer;
    },
    systemsReady,
    setHostStarNameOf(fn) {
      hostStarNameOf = fn;
    },

    async load(loadBaseUrl: string): Promise<void> {
      baseUrl = loadBaseUrl;
    },

    attach(kindCtx: KindContext): SceneLayer {
      ctx = kindCtx;
      field = new PlanetBodyField(kindCtx.sharedUniforms);
      meshLayer = new PlanetMeshLayer(
        field, baseUrl, kindCtx.sharedUniforms, kindCtx.requestRender,
        kindCtx.maxTextureSize,
      );
      kindCtx.scene.add(field.group);

      // Horizons element tables — 1.5 MB that upgrades the ephemeris from
      // the Standish series' 0.06 AU to ~5e-6 AU across 1900–2100. Fired
      // at attach, not load: load runs inside the boot Promise.all, where
      // this fetch would contend with the catalog download. Deliberately
      // NOT awaited — the first frame is Sol-focused, where the outer
      // planets the tables move are sub-pixel discs, so paying for it
      // before first paint would buy nothing visible.
      void loadPlanetElementTables(baseUrl);

      // Attach Sol's planet system once at boot. Bodies render from now
      // on independent of focus, gated only by apparent-mag visibility +
      // the per-host distance cull. The attach lands on a microtask —
      // potentially after a synchronous URL restore would have run —
      // which is what `systemsReady` exists to sequence.
      const solIdx = kindCtx.solIndex;
      const photo = solIdx >= 0 ? kindCtx.starPhotometry(solIdx) : null;
      const solAbs = new THREE.Vector3();
      if (photo !== null && kindCtx.solAbsInto(solAbs)) {
        // `getPlanetSystem` is the sole "does this host have planets?"
        // gate — it resolves null for a host without them, the branch
        // bk5's per-host shard fetch will actually reach.
        void getPlanetSystem(solIdx, solIdx).then((ps) => {
          if (ps !== null) {
            field!.attachHost(
              solIdx, ps, photo.absMag, photo.radiusPc, solAbs, solIdx, kindCtx.getT(),
            );
          }
          resolveSystemsReady();
        });
      } else {
        resolveSystemsReady();
      }

      return {
        timeBehaviour: {
          kind: 'clock',
          budgetSimS: (fc) => field!.cadenceSimBudgetS(
            fc.camera.position, fc.pxPerRadian, fc.pixelRatio),
        },
        update: (fc) => field!.update(fc.camera, fc.t, performance.now()),
        setMonochrome: (on) => field!.setMonochrome(on),
        recenter: (newOrigin) => field!.recenter(newOrigin),
        dispose: () => {
          field!.dispose();
          meshLayer!.dispose();
        },
      };
    },

    focusable: (): FocusableProvider => ({
      anchorInto: (idx, out) => field?.planetAbsolutePositionInto(idx, out) ?? false,
      localPositionInto: (idx, out) => field?.planetLocalPositionInto(idx, out) ?? false,
      focusParkDistance: (idx) => {
        const r = planetRadiusPc(idx);
        return r === null
          ? 0
          : starPhysics.parkDistForPlanet(r, starPhysics.fovMinorRad(ctx!.camera));
      },
      orbitFloor: (idx) => {
        const r = planetRadiusPc(idx);
        return r === null
          ? 0
          : starPhysics.minOrbitDistForPlanet(r, starPhysics.fovMinorRad(ctx!.camera));
      },
      arrivalRadiusPc: planetRadiusPc,
      renderedSizePx: (idx) =>
        field?.renderedPlanetSizePx(idx, ctx!.camera.position) ?? 0,
      chartPlateauDistance: () => null,
      planetSystemHost: (idx) => field?.hostPlanetOf(idx)?.hostStarIdx ?? null,
    }),

    card: (): FocusCardProvider<'planet'> => createPlanetFocusProvider({
      planetAt: (idx) => field?.planetAt(idx) ?? null,
      orbitDescriptorOf,
      cameraDistancePc: (idx) => {
        if (!field?.planetLocalPositionInto(idx, tmpLocal)) return null;
        return tmpLocal.distanceTo(ctx!.camera.position);
      },
      appMagFor: (idx) => field?.appMagForInstance(idx, ctx!.camera.position) ?? null,
      constellationName: (idx) => ctx?.constellationOf('planet', idx) ?? null,
      moonNamesOf: (idx) => {
        const attached = attachedHostOf(idx);
        return attached === null ? [] : moonNamesOf(attached.ps.planets, attached.host.planetIdx);
      },
    }),

    hover: (): HoverProvider<'planet'> => ({
      kind: 'planet',
      pick,
      format: (hit) => {
        const attached = attachedHostOf(hit.idx);
        if (attached === null) return null;
        const { host, ps } = attached;
        return formatPlanetHover(host.planetIdx, hit.cameraDistancePc, {
          planets: ps.planets,
          appMagFor: (i) => field!.appMagFor(host.hostStarIdx, i, ctx!.camera.position),
          // Period only — the hover card shows no breadcrumb, so the
          // host name is irrelevant (null).
          orbitOf: (i) => {
            const p = ps.planets[i];
            return p ? orbitDescriptorFor(p, ps, null) : null;
          },
          moonsOf: (i) => moonNamesOf(ps.planets, i),
          membership: ctx!.systemMembership,
          targetOf: (i) => {
            const flat = field!.instanceIndexOf(host.hostStarIdx, i);
            return flat === null ? null : { kind: 'planet', idx: flat };
          },
        });
      },
    }),

    pinnable: (idx) => (field?.planetAt(idx) ?? null) !== null,

    searchEntries: (): KindSearchEntry[] => {
      // Deliberately Sol-only (bk5 exoplanets are visit-to-discover).
      // Rows carry the field's flat Target index, so the corpus build
      // must run after `systemsReady` (main.ts awaits it before binding
      // search); an unattached field contributes nothing rather than
      // wrong indices.
      const solIdx = ctx?.solIndex ?? -1;
      if (!field || solIdx < 0) return [];
      const out: KindSearchEntry[] = [];
      for (let i = 0; i < SOL_BODIES.length; i++) {
        const flat = field.instanceIndexOf(solIdx, i);
        if (flat === null) continue;
        const p = SOL_BODIES[i];
        out.push({
          index: flat,
          label: p.name,
          primary: p.name,
          displayCon: p.parentName ? `Moon · ${p.parentName}` : 'Planet · Sol system',
        });
      }
      return out;
    },

    displayName: (idx) => field?.planetAt(idx)?.name ?? '',

    // The planet SID domain is keyed body-within-host (docs/sid.md § 7)
    // — the one domain whose localIndex is NOT the Target idx; url-state
    // translates at the boundary (IdMaps.planetDomainIndexOf). The list
    // is static, so the domain attaches whether or not a host ever does.
    sids: () => SOL_BODIES.map((p) => SOL_OBJECT_SIDS[p.name.toLowerCase()] ?? 0),

    setFocalHidden: (idx) => field?.setHiddenInstance(idx),
  };
}
