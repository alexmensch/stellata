// Trail focus gate + the marker field's visible/sampled split. See
// README.md § Trails.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AU_PC } from '../../util/astronomy-constants';
import { tToJDE } from '../time/time';
import type { ProbeTrajectoryFile } from '../../../../scripts/probes/probe-trajectory-schema';
import { PROBE_MARKER_PX, ProbeField, type ProbeSharedUniforms } from './probe-field';
import { ProbePathLayer } from './probe-path-layer';
import { buildProbeTrajectory } from './probe-trajectory';

const STEP_DAYS = 30;
const FIRST_JD = tToJDE(0);

// Two probes marching out along ICRS x at 1 AU per 30 days, far enough out
// that both the fleet cull and the per-trail legibility gate clear.
function makeFile(id: string, startAu: number): ProbeTrajectoryFile {
  return {
    id,
    label: id,
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
      FIRST_JD + i * STEP_DAYS, startAu + i, 0, 0, 1 / STEP_DAYS, 0, 0,
    ]),
  };
}

const ROSTER = [makeFile('alpha', 40), makeFile('beta', 80)]
  .map(buildProbeTrajectory);

function makeHarness() {
  const shared: ProbeSharedUniforms = {
    uViewport: { value: new THREE.Vector2(800, 600) },
    uPixelRatio: { value: 1 },
    uFovYRad: { value: (50 * Math.PI) / 180 },
  };
  const field = new ProbeField(shared);
  const layer = new ProbePathLayer(shared);
  field.attach(ROSTER);
  layer.attach(ROSTER);
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 1e-12, 1e5);
  // Just off the first probe, inside the inner system where the
  // heliosphere subtends the whole view — both markers stay drawn.
  camera.position.set(41 * AU_PC, 0, 0);
  const t = ROSTER[0].sampleT[2];
  const draw = (focusedIdx: number) => {
    field.update(t, camera);
    layer.update(field, t, camera, focusedIdx);
    return layer.group.children.map((c) => c.visible);
  };
  return { field, layer, draw };
}

describe('ProbePathLayer focus gate', () => {
  it('draws no trail when nothing is focused', () => {
    expect(makeHarness().draw(-1)).toEqual([false, false]);
  });

  it('draws exactly the focused probe\'s trail', () => {
    const h = makeHarness();
    expect(h.draw(0)).toEqual([true, false]);
    expect(h.draw(1)).toEqual([false, true]);
  });

  it('drops the trail again when the focus goes away', () => {
    const h = makeHarness();
    h.draw(1);
    expect(h.draw(-1)).toEqual([false, false]);
  });

  it('drops the focused trail when its own marker is hidden as the observe anchor', () => {
    const h = makeHarness();
    expect(h.draw(0)).toEqual([true, false]);
    h.field.setHiddenInstance(0);
    expect(h.draw(0)).toEqual([false, false]);
  });
});

describe('ProbeField visible vs sampled', () => {
  it('keeps reporting a position for a probe the declutter cycle hid', () => {
    const h = makeHarness();
    h.field.setPermitted(false);
    h.draw(0);
    // The focus path and the moving-focal ride read localPositionInto, so a
    // decluttered or chart-hidden marker must NOT strand a focused camera.
    const out = new THREE.Vector3();
    expect(h.field.localPositionInto(0, out)).toBe(true);
    expect(h.field.sampleFor(0)!.visible).toBe(false);
  });

  it('reports no position before the trajectory starts', () => {
    const h = makeHarness();
    h.draw(0);
    const camera = new THREE.PerspectiveCamera(50, 4 / 3, 1e-12, 1e5);
    h.field.update(ROSTER[0].sampleT[0] - 1, camera);
    expect(h.field.localPositionInto(0, new THREE.Vector3())).toBe(false);
  });
});

describe('PROBE_MARKER_PX', () => {
  it('is the shared basis for the marker glyph and its hit radius', () => {
    expect(PROBE_MARKER_PX).toBe(9);
  });
});
