// Trail focus gate + the marker field's visible/sampled split. See
// README.md § Trails.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AU_PC } from '../../util/astronomy-constants';
import { tToJDE } from '../time/time';
import type { ProbeTrajectoryFile } from '../../../../scripts/probes/probe-trajectory-schema';
import { PROBE_MARKER_PX, ProbeField, type ProbeSharedUniforms } from './probe-field';
import { ProbePathLayer } from './probe-path-layer';
import { builtinChromeLineMaterials } from '../../chrome-lines/builtin-chrome-lines';
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
  const layer = new ProbePathLayer(shared, builtinChromeLineMaterials());
  const t = ROSTER[0].sampleT[2];
  field.attach(ROSTER, t);
  layer.attach(ROSTER);
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 1e-12, 1e5);
  // Just off the first probe, inside the inner system where the
  // heliosphere subtends the whole view — both markers stay drawn.
  camera.position.set(41 * AU_PC, 0, 0);
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

describe('ProbeField out-of-frame reads', () => {
  it('resolves a position from attach alone, before any update', () => {
    // Probe focus applies from a URL before the first frame runs, and it
    // bails on a false localPositionInto — so the attach seed is what keeps
    // a shared probe link from decoding to Sol.
    const field = new ProbeField({
      uViewport: { value: new THREE.Vector2(800, 600) },
      uPixelRatio: { value: 1 },
      uFovYRad: { value: (50 * Math.PI) / 180 },
    });
    field.attach(ROSTER, ROSTER[0].sampleT[2]);
    const out = new THREE.Vector3();
    expect(field.localPositionInto(0, out)).toBe(true);
    expect(out.x).toBeCloseTo(42 * AU_PC, 12);
  });

  it('resamples to a jumped clock without a frame in between', () => {
    const h = makeHarness();
    const out = new THREE.Vector3();
    h.field.resampleAt(ROSTER[0].sampleT[0]);
    expect(h.field.localPositionInto(0, out)).toBe(true);
    expect(out.x).toBeCloseTo(40 * AU_PC, 12);
  });

  it('rebases localPc onto a new origin, so a focus recentre reads the new frame', () => {
    // The hard-focus setter calls localPositionInto immediately after the
    // recentre it triggered; a stale localPc would shift the camera by the
    // delta.
    const h = makeHarness();
    h.draw(0);
    const shift = new THREE.Vector3(5 * AU_PC, 0, 0);
    h.field.recenter(shift);
    const out = new THREE.Vector3();
    expect(h.field.localPositionInto(0, out)).toBe(true);
    expect(out.x).toBeCloseTo(42 * AU_PC - shift.x, 12);
  });
});

describe('local depth pass membership', () => {
  // While the solar system is locally active every one of its bodies renders
  // in the bracketed pass with depth CLEARED, so a main-pass probe row is
  // painted over by any planet disc regardless of true depth. Exactly one of
  // the two groups draws.
  it('moves the marker and its trail between passes, never drawing both', () => {
    const h = makeHarness();
    h.draw(0);
    expect([h.field.group.visible, h.field.localGroup.visible]).toEqual([true, false]);
    expect([h.layer.group.visible, h.layer.localGroup.visible]).toEqual([true, false]);

    h.field.setLocalPassActive(true);
    h.layer.setLocalPassActive(true);
    expect([h.field.group.visible, h.field.localGroup.visible]).toEqual([false, true]);
    expect([h.layer.group.visible, h.layer.localGroup.visible]).toEqual([false, true]);

    h.field.setLocalPassActive(false);
    h.layer.setLocalPassActive(false);
    expect([h.field.group.visible, h.field.localGroup.visible]).toEqual([true, false]);
  });

  it('keeps a decluttered layer hidden in both passes', () => {
    const h = makeHarness();
    h.field.setPermitted(false);
    h.layer.setPermitted(false);
    h.draw(0);
    h.field.setLocalPassActive(true);
    h.layer.setLocalPassActive(true);
    expect(h.field.localGroup.visible).toBe(false);
    expect(h.layer.localGroup.visible).toBe(false);
  });

  it('mirrors each trail\'s visibility and anchor drift onto its local twin', () => {
    // The mirror shares the geometry but not the transform, so a missed
    // position copy detaches the local-pass trail from its marker.
    const h = makeHarness();
    h.draw(0);
    const [line, localLine] = [h.layer.group.children[0], h.layer.localGroup.children[0]];
    expect([line.visible, localLine.visible]).toEqual([true, true]);
    expect(localLine.position.toArray()).toEqual(line.position.toArray());
    expect((localLine as THREE.Line).geometry).toBe((line as THREE.Line).geometry);
    h.draw(1);
    expect([line.visible, localLine.visible]).toEqual([false, false]);
  });

  it('pins the probe rows\' render order in both passes', () => {
    // Main pass: above the star discs, below the planet glare (4) so a
    // marker over a bright body doesn't paint out its disc. Local pass:
    // after the planet disc mirrors (3) and the orbit rings (3.2) so the
    // marker depth-tests against real body depth, below the star glow
    // mirror (3.5). Trails sit just under their marker in either pass.
    // See src/client/local-depth/README.md.
    const h = makeHarness();
    const orderByName = new Map(
      [...h.field.group.children, ...h.field.localGroup.children]
        .map((m) => [m.name, m.renderOrder]),
    );
    expect(orderByName.get('probe-marker')).toBe(3.5);
    expect(orderByName.get('probe-marker-local')).toBe(3.3);
    expect(h.layer.group.renderOrder).toBe(3.4);
    expect(h.layer.localGroup.renderOrder).toBe(3.25);
  });
});

describe('PROBE_MARKER_PX', () => {
  it('is the shared basis for the marker glyph and its hit radius', () => {
    expect(PROBE_MARKER_PX).toBe(9);
  });
});
