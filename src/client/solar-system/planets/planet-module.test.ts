// Planet kind-module contract: absence before attach, the boot host
// attach behind systemsReady, and the capability legs over the field.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { KindContext } from '../../kinds/kind-module';
import {
  makeKindContext,
  makeMockHdrEmitterUniforms,
  MOCK_FOV_Y_RAD,
  MOCK_VIEWPORT_H,
  MOCK_VIEWPORT_W,
} from '../../kinds/kind-context-mock';
import { buildStarSharedUniforms } from '../../star-pipeline/frame/star-shared-uniforms';
import { R_SUN_PC } from '../../util/astronomy-constants';
import { getPlanetSystem, SOL_BODIES } from '../planet-system';
import { SOL_OBJECT_SIDS } from '../sol-object-sids';
import { createPlanetKindModule, type PlanetKindModule } from './planet-module';

const SOL_PHOTOMETRY = { absMag: 4.83, radiusPc: R_SUN_PC };
const MARS = SOL_BODIES.findIndex((b) => b.name === 'Mars');
const EUROPA = SOL_BODIES.findIndex((b) => b.name === 'Europa');
const DECOY_HOST = 41;
/** 10 kpc up the +Z axis: past any planet's cull distance and behind
 *  the pick test's camera, so the decoy never enters a pick or a draw. */
const DECOY_HOST_POS = new THREE.Vector3(0, 0, 1e4);

function makeCtx(overrides: Partial<KindContext> = {}): KindContext {
  // Same viewport / FOV as the mock's camera and canvas rect, so pick
  // projections and screen-centre coordinates agree across both maps.
  const sharedUniforms = buildStarSharedUniforms({
    pixelRatio: 1,
    fovYRad: MOCK_FOV_Y_RAD,
    viewportW: MOCK_VIEWPORT_W,
    viewportH: MOCK_VIEWPORT_H,
    hdr: makeMockHdrEmitterUniforms(),
  });
  return makeKindContext({
    sharedUniforms,
    solIndex: 0,
    starPhotometry: (idx) => (idx === 0 ? SOL_PHOTOMETRY : null),
    ...overrides,
  });
}

/** Attach, but slip a decoy host in ahead of the module's own Sol
 *  attach — that lands on a microtask, this call is synchronous — so
 *  Sol's flat range starts past zero and the flat Target index stops
 *  coinciding with the body-within-host index. Without it every fixture
 *  has Sol at flat 0 and the two index spaces are indistinguishable,
 *  which is exactly the confusion the module's translation prevents.
 *  Returns Sol's flat offset. */
async function attachBehindDecoyHost(
  m: PlanetKindModule,
  ctx: KindContext,
): Promise<number> {
  const decoy = (await getPlanetSystem(DECOY_HOST, DECOY_HOST))!;
  m.attach(ctx);
  m.field.attachHost(
    DECOY_HOST,
    decoy,
    SOL_PHOTOMETRY.absMag,
    SOL_PHOTOMETRY.radiusPc,
    DECOY_HOST_POS,
    DECOY_HOST,
    0,
  );
  await m.systemsReady;
  return m.field.instanceIndexOf(0, 0)!;
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
    // Sol is the only boot host here, so the two index spaces coincide
    // — the decoy-host test below is what tells them apart.
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
    const offset = await attachBehindDecoyHost(m, ctx);
    const flatMars = offset + MARS;
    expect(flatMars).not.toBe(MARS);

    // Park the camera just off Mars and look at it — the body projects
    // to screen centre, bright and resolved.
    const mars = new THREE.Vector3();
    m.field.planetLocalPositionInto(flatMars, mars);
    ctx.camera.position.copy(mars).add(new THREE.Vector3(0, 0, 5e-9));
    ctx.camera.lookAt(mars);
    ctx.camera.updateMatrixWorld();

    const { pick, format } = m.hover!();
    const hit = pick(400, 300, 14);
    expect(hit?.idx).toBe(flatMars);
    expect(hit?.hostStarIdx).toBe(0);
    // The formatter takes the flat index back to (host, body-within-host).
    const payload = format(hit!);
    expect(payload?.name).toBe('Mars');

    expect(pick(0, 0, 14)).toBeNull();
  });

  it('search rows and every index leg carry the flat Target index', async () => {
    const m = createPlanetKindModule();
    m.setHostStarNameOf((idx) => (idx === 0 ? 'Sol' : null));
    await m.load('/');
    const offset = await attachBehindDecoyHost(m, makeCtx());
    expect(offset).toBe(SOL_BODIES.length);

    const flatMars = offset + MARS;
    expect(m.searchEntries().find((e) => e.label === 'Mars')!.index).toBe(flatMars);
    expect(m.displayName(flatMars)).toBe('Mars');
    expect(m.pinnable(flatMars)).toBe(true);
    expect(m.card().format(flatMars).name).toBe('Mars');
    expect(m.focusable().planetSystemHost(flatMars)).toBe(0);
    // Sol's body-within-host indices now belong to the decoy, so a leg
    // that forgot to translate would answer for the wrong host.
    expect(m.focusable().planetSystemHost(MARS)).toBe(DECOY_HOST);
  });

  it('setFocalHidden drives the field hide slot; -1 unhides', async () => {
    const m = createPlanetKindModule();
    await m.load('/');
    m.attach(makeCtx());
    await m.systemsReady;

    // Slot-based on purpose: the hide is shader-side (uHideIdx), and
    // planet-body-field.test.ts pins the uniform fan-out behind it.
    expect(m.field.hiddenInstanceIdx).toBe(-1);
    m.setFocalHidden!(MARS);
    expect(m.field.hiddenInstanceIdx).toBe(MARS);
    m.setFocalHidden!(-1);
    expect(m.field.hiddenInstanceIdx).toBe(-1);
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
