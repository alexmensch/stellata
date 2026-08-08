// Planet kind-module contract: absence before attach, the boot host
// attach behind systemsReady, and the capability legs over the field.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { HdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import type { KindContext } from '../../kinds/kind-module';
import { makeKindContext } from '../../kinds/kind-context-mock';
import { buildStarSharedUniforms } from '../../star-pipeline/frame/star-shared-uniforms';
import { R_SUN_PC } from '../../util/astronomy-constants';
import { SOL_BODIES } from '../planet-system';
import { SOL_OBJECT_SIDS } from '../sol-object-sids';
import { createPlanetKindModule } from './planet-module';

const SOL_PHOTOMETRY = { absMag: 4.83, radiusPc: R_SUN_PC };
const MARS = SOL_BODIES.findIndex((b) => b.name === 'Mars');
const EUROPA = SOL_BODIES.findIndex((b) => b.name === 'Europa');

function makeCtx(overrides: Partial<KindContext> = {}): KindContext {
  const sharedUniforms = buildStarSharedUniforms({
    pixelRatio: 1,
    fovYRad: (50 * Math.PI) / 180,
    viewportW: 800,
    viewportH: 600,
    hdr: {
      uExposure: { value: 1 },
      uOmegaPxArcsec2: { value: 1 },
      uWhitePoint: { value: 1 },
      uHighlightDesat: { value: 0 },
      uHdrTarget: { value: 0 },
    } as HdrEmitterUniforms,
  });
  return makeKindContext({
    sharedUniforms,
    solIndex: 0,
    starPhotometry: (idx) => (idx === 0 ? SOL_PHOTOMETRY : null),
    ...overrides,
  });
}

describe('planet kind module', () => {
  it('degrades to absence before attach; the SID domain is static', () => {
    const m = createPlanetKindModule();
    expect(m.pinnable(0)).toBe(false);
    expect(m.searchEntries()).toEqual([]);
    expect(m.displayName(0)).toBe('');
    const sids = m.sids()!;
    expect(sids).toEqual(SOL_BODIES.map((p) => SOL_OBJECT_SIDS[p.name.toLowerCase()]));
    expect(sids.every((s) => s > 0)).toBe(true);
  });

  it('attaches Sol at boot and answers every leg from the field', async () => {
    const m = createPlanetKindModule();
    await m.load('/');
    const ctx = makeCtx();
    const layer = m.attach(ctx);
    expect(layer).not.toBeNull();
    await m.systemsReady;

    expect(m.field.getAttachedPlanetSystem(0)).not.toBeNull();
    expect(m.field.liveInstanceCount).toBe(SOL_BODIES.length);
    expect(m.displayName(MARS)).toBe('Mars');
    expect(m.pinnable(MARS)).toBe(true);
    expect(m.pinnable(SOL_BODIES.length)).toBe(false);

    const entries = m.searchEntries();
    expect(entries.length).toBe(SOL_BODIES.length);
    const mars = entries.find((e) => e.label === 'Mars')!;
    // Sol is the only boot host, so its flat range starts at 0 and the
    // flat Target index coincides with the body-within-host index.
    expect(mars.index).toBe(MARS);
    expect(mars.displayCon).toBe('Planet · Sol system');
    expect(entries.find((e) => e.label === 'Europa')!.displayCon).toBe('Moon · Jupiter');

    const provider = m.focusable();
    const local = new THREE.Vector3();
    expect(provider.localPositionInto(MARS, local)).toBe(true);
    expect(local.lengthSq()).toBeGreaterThan(0);
    expect(provider.localPositionInto(SOL_BODIES.length, local)).toBe(false);
    expect(provider.focusParkDistance(MARS)).toBeGreaterThan(0);
    expect(provider.orbitFloor(MARS)).toBeGreaterThan(0);
    expect(provider.orbitFloor(MARS)).toBeLessThan(provider.focusParkDistance(MARS));
    expect(provider.arrivalRadiusPc(MARS)).toBeGreaterThan(0);
    expect(provider.chartPlateauDistance(MARS, 0)).toBeNull();
    expect(provider.planetSystemHost(MARS)).toBe(0);
  });

  it('the card breadcrumb reads the injected host-star name', async () => {
    const m = createPlanetKindModule();
    m.setHostStarNameOf((idx) => (idx === 0 ? 'Sol' : null));
    await m.load('/');
    m.attach(makeCtx());
    await m.systemsReady;

    const card = m.card();
    expect(card.kind).toBe('planet');
    const content = card.format(MARS);
    expect(content.name).toBe('Mars');
    expect(content.identityLines).toContain('Orbiting Sol');
    expect(content.identityLines).toContain('Rocky planet');
    const europa = card.format(EUROPA);
    expect(europa.identityLines).toContain('Orbiting Jupiter');
  });

  it('picks through the hover surface with the flat Target index', async () => {
    const m = createPlanetKindModule();
    await m.load('/');
    const ctx = makeCtx();
    m.attach(ctx);
    await m.systemsReady;

    // Park the camera just off Mars and look at it — the body projects
    // to screen centre, bright and resolved.
    const mars = new THREE.Vector3();
    m.field.planetLocalPositionInto(MARS, mars);
    ctx.camera.position.copy(mars).add(new THREE.Vector3(0, 0, 5e-9));
    ctx.camera.lookAt(mars);
    ctx.camera.updateMatrixWorld();

    const { pick, format } = m.hover!();
    const hit = pick(400, 300, 14);
    expect(hit?.idx).toBe(MARS);
    expect(hit?.hostStarIdx).toBe(0);
    const payload = format(hit!);
    expect(payload?.name).toBe('Mars');

    expect(pick(0, 0, 14)).toBeNull();
  });

  it('resolves systemsReady with an empty field when there is no Sol', async () => {
    const m = createPlanetKindModule();
    await m.load('/');
    m.attach(makeCtx({ solIndex: -1, starPhotometry: () => null }));
    await m.systemsReady;
    expect(m.field.liveInstanceCount).toBe(0);
    expect(m.searchEntries()).toEqual([]);
  });
});
