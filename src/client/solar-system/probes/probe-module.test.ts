// Probe kind-module contract: load-missing degrades to absence, and the
// capability legs answer from the loaded roster after attach.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PROBE_MISSIONS } from '../../../../scripts/probes/probe-roster';
import type { ProbeTrajectoryFile } from '../../../../scripts/probes/probe-trajectory-schema';
import { PROBE_ORBIT_FLOOR_PC, PROBE_PARK_DIST_PC } from './probe-focus-geometry';
import type { KindContext } from '../../kinds/kind-module';
import type { StarSharedUniforms } from '../../star-pipeline/frame/star-shared-uniforms';
import { AU_PC } from '../../util/astronomy-constants';
import { tToJDE } from '../time/time';
import { SOL_OBJECT_SIDS } from '../sol-object-sids';
import { PROBE_MARKER_PX } from './probe-field';
import { createProbeKindModule } from './probe-module';

const STEP_DAYS = 30;
const FIRST_JD = tToJDE(0);

function makeFile(id: string, label: string): ProbeTrajectoryFile {
  return {
    id,
    label,
    mission: 'Fixture.',
    horizonsId: '-1',
    launchUtc: '1970-01-01T00:00:00Z',
    launchUnixMs: 0,
    lastContactUtc: null,
    lastContactUnixMs: null,
    source: {
      frame: 'ICRF', center: 'Sun (10)', units: 'AU-D',
      targetBody: id, retrievedUtc: '2026-07-25T00:00:00Z',
    },
    chordToleranceAu: 1e-5,
    columns: ['jd', 'x', 'y', 'z', 'vx', 'vy', 'vz'],
    samples: [0, 1, 2].map((i) => [
      FIRST_JD + i * STEP_DAYS, 40 + i, 0, 0, 1 / STEP_DAYS, 0, 0,
    ]),
  };
}

function makeCtx(): KindContext {
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 1e-12, 1e5);
  camera.position.set(41 * AU_PC, 0, 0);
  const sharedUniforms = {
    uViewport: { value: new THREE.Vector2(800, 600) },
    uPixelRatio: { value: 1 },
    uFovYRad: { value: (50 * Math.PI) / 180 },
  } as unknown as StarSharedUniforms;
  return {
    scene: new THREE.Scene(),
    camera,
    canvas: {
      getBoundingClientRect: () => ({
        left: 0, top: 0, width: 800, height: 600,
      } as DOMRect),
    } as unknown as HTMLElement,
    sharedUniforms,
    solIndex: 7,
    getT: () => 0,
    getWorldOffset: () => new THREE.Vector3(),
    getFocusedTarget: () => null,
    getMonochrome: () => false,
    detailPermits: () => true,
    constellationOf: () => 'Ophiuchus',
    onFrame: () => () => {},
  };
}

/** Serve fixture JSON for `present` mission ids, 404 for the rest. */
function stubFetch(present: readonly string[]): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const mission = PROBE_MISSIONS.find((m) => url.includes(m.id));
    if (!mission || !present.includes(mission.id)) {
      return { ok: false, status: 404 } as Response;
    }
    return {
      ok: true,
      json: async () => makeFile(mission.id, mission.label),
    } as unknown as Response;
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('probe kind module', () => {
  it('degrades to absence before load / when every artifact is missing', async () => {
    stubFetch([]);
    const m = createProbeKindModule();
    expect(m.pinnable(0)).toBe(false);
    expect(m.searchEntries()).toEqual([]);
    expect(m.displayName(0)).toBe('');
    await m.load('/');
    m.attach(makeCtx());
    expect(m.sids()).toEqual([]);
    expect(m.searchEntries()).toEqual([]);
    expect(m.pinnable(0)).toBe(false);
    expect(m.field.probeCount()).toBe(0);
  });

  it('answers every leg from the loaded roster, missing artifacts dropped', async () => {
    stubFetch(['pioneer10', 'voyager1']);
    const m = createProbeKindModule();
    await m.load('/');
    const ctx = makeCtx();
    const layer = m.attach(ctx);
    expect(layer).not.toBeNull();

    expect(m.field.probeCount()).toBe(2);
    expect(m.sids()).toEqual([SOL_OBJECT_SIDS.pioneer10, SOL_OBJECT_SIDS.voyager1]);
    expect(m.searchEntries().map((e) => e.label)).toEqual(['Pioneer 10', 'Voyager 1']);
    expect(m.searchEntries()[0].displayCon).toBe('Probe · Interstellar');
    expect(m.displayName(1)).toBe('Voyager 1');
    expect(m.pinnable(1)).toBe(true);
    expect(m.pinnable(2)).toBe(false);

    const provider = m.focusable();
    expect(provider.focusParkDistance(0)).toBe(PROBE_PARK_DIST_PC);
    expect(provider.orbitFloor(0)).toBe(PROBE_ORBIT_FLOOR_PC);
    expect(provider.renderedSizePx(0)).toBe(PROBE_MARKER_PX);
    expect(provider.planetSystemHost(0)).toBe(7);
    const local = new THREE.Vector3();
    expect(provider.localPositionInto(0, local)).toBe(true);
    expect(local.x).toBeCloseTo(40 * AU_PC, 8);
    expect(provider.localPositionInto(5, local)).toBe(false);

    const card = m.card();
    expect(card.kind).toBe('probe');
    const content = card.format(1);
    expect(content.name).toBe('Voyager 1');
    expect(content.identityLines).toEqual(['Deep-space probe']);

    expect(m.hover?.().kind).toBe('probe');
  });

  it('picks the marker under the cursor through the shared pick surface', async () => {
    stubFetch(['voyager1']);
    const m = createProbeKindModule();
    await m.load('/');
    const ctx = makeCtx();
    const layer = m.attach(ctx)!;
    ctx.camera.lookAt(40 * AU_PC, 0, 0);
    ctx.camera.updateMatrixWorld();
    layer.update?.({
      camera: ctx.camera,
      worldOffset: new THREE.Vector3(),
      distFromSol: 41 * AU_PC,
      t: 0,
      warpActive: false,
    });
    // The marker sits at screen centre: prime pick there, none far away.
    const { pick } = m.hover!();
    expect(pick(400, 300, 14)?.idx).toBe(0);
    expect(pick(0, 0, 14)).toBeNull();
  });
});
