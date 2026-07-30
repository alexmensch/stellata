import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { RenderedSizeComponents } from '../../camera/controls/star-physics';
import { luminanceForMagnitude } from '../emission-pure';
import { exposureForMagLimit } from './exposure-epoch';
import { SceneAdaptation, type SceneAdaptationDeps } from './scene-adaptation';
import {
  ADAPT_SLEW_TAU_S,
  DIFFUSE_FIELD_L,
  eyeAdaptationDm,
  highlightGuardDm,
  L_ADAPT,
  L_CAP,
  type LuminanceSample,
  negligibleAppMag,
  starAdaptationWindowPc,
} from './scene-adaptation-pure';

const W = 1920;
const H = 1080;
const EXPOSURE = exposureForMagLimit(7.8);

interface Star {
  pc: number;
  appMag: number;
  physSizePx?: number;
  label?: string;
}

function harness(bodies: LuminanceSample[], stars: Star[] = []) {
  const camera = new THREE.PerspectiveCamera(50, W / H, 1e-12, 1e9);
  camera.position.set(0, 0, 0);
  camera.updateMatrixWorld();
  // Stars sit straight down −Z, the default look direction, so every one
  // of them projects to the centre of the frame.
  const positions = new Float32Array(stars.length * 3);
  stars.forEach((s, i) => { positions[i * 3 + 2] = -s.pc; });
  const deps: SceneAdaptationDeps = {
    viewport: { value: new THREE.Vector2(W, H) },
    baseExposure: () => EXPOSURE,
    bodies: {
      forEachDrawnBody: (_camera, _w, _h, visit) => { for (const b of bodies) visit(b); },
    },
    stars: {
      forEachStarNearCamera: (dPc, cb) => {
        for (let i = 0; i < stars.length; i++) {
          if (stars[i].pc <= dPc && cb(i)) return;
        }
      },
      renderedSizeComponents: (idx, out): RenderedSizeComponents => {
        out.appMag = stars[idx].appMag;
        out.appSizePx = 1;
        out.physSizePx = stars[idx].physSizePx ?? 0;
        return out;
      },
      localPositions: () => positions,
      starLabel: (idx) => stars[idx].label ?? null,
    },
  };
  return { adaptation: new SceneAdaptation(deps), camera };
}

function body(patch: Partial<LuminanceSample>): LuminanceSample {
  return {
    appMag: 0,
    diameterPx: 0,
    screenX: 0.5 * W,
    screenY: 0.5 * H,
    cameraDistancePc: 1,
    fluxScale: 1,
    label: null,
    ...patch,
  };
}

describe('SceneAdaptation', () => {
  it('reports no cut on an empty dark frame', () => {
    const { adaptation, camera } = harness([]);
    expect(adaptation.measure(camera, false, 0, false)).toBe(0);
    expect(adaptation.getMeanLuminance()).toBe(DIFFUSE_FIELD_L);
    expect(adaptation.getDominantLabel()).toBeNull();
  });

  it('cuts on a resolved body and names what it adapted to', () => {
    // Coverage cancels: a disc's surface brightness × its area is its
    // flux, so the cut follows the flux whatever the disc's size.
    const coverage = 0.2;
    const diameterPx = 2 * Math.sqrt((coverage * W * H) / Math.PI);
    const surfaceL = 3.57e5;
    const appMag = -2.5 * Math.log10((surfaceL * coverage * W * H) / EXPOSURE);
    const { adaptation, camera } = harness([body({ appMag, diameterPx, label: 'Venus' })]);
    const dm = adaptation.measure(camera, false, 0, false);
    // Well over the handover coverage, so the guard governs and the disc
    // lands on L_CAP rather than on the perception branch's L_ADAPT/f.
    expect(adaptation.getPeakLuminance()).toBeCloseTo(surfaceL, -1);
    expect(dm).toBeCloseTo(highlightGuardDm(surfaceL), 9);
    expect(dm).toBeGreaterThan(eyeAdaptationDm(surfaceL * coverage + DIFFUSE_FIELD_L));
    expect(surfaceL * 10 ** (0.4 * dm)).toBeCloseTo(L_CAP, 9);
    expect(adaptation.getDominantLabel()).toBe('Venus');
  });

  it('takes the eclipse dim as a real flux loss', () => {
    const lit = body({ appMag: -20, label: 'Io' });
    const eclipsed = body({ appMag: -20, fluxScale: 0.01, label: 'Io' });
    const a = harness([lit]);
    const b = harness([eclipsed]);
    const dmLit = a.adaptation.measure(a.camera, false, 0, false);
    const dmEclipsed = b.adaptation.measure(b.camera, false, 0, false);
    expect(dmLit - dmEclipsed).toBeCloseTo(-5, 3);
  });

  it('drops a source hidden behind a nearer body', () => {
    // Sol behind the night side of Saturn: the one contributing source in
    // the frame is light that never reached the camera.
    const sol = body({ appMag: -26, diameterPx: 11, cameraDistancePc: 1e-4, label: 'Sol' });
    // Night side, so the occluder contributes no flux of its own.
    const saturn = body({
      appMag: 30, diameterPx: 900, cameraDistancePc: 1e-5, label: 'Saturn',
    });
    const open = harness([sol]);
    const blocked = harness([sol, saturn]);
    expect(open.adaptation.measure(open.camera, false, 0, false)).toBeLessThan(-15);
    expect(blocked.adaptation.measure(blocked.camera, false, 0, false)).toBe(0);
    expect(blocked.adaptation.getMeanLuminance()).toBeCloseTo(DIFFUSE_FIELD_L, 12);
  });

  it('lets an occluder be occluded in turn without reordering the walk', () => {
    // Visited nearest-last, so a streaming reduce would have missed it.
    const back = body({ appMag: -26, diameterPx: 11, cameraDistancePc: 1, label: 'Sol' });
    const mid = body({ appMag: -20, diameterPx: 900, cameraDistancePc: 0.5, label: 'Saturn' });
    const front = body({ appMag: -15, diameterPx: 4000, cameraDistancePc: 0.1, label: 'Titan' });
    const { adaptation, camera } = harness([back, mid, front]);
    adaptation.measure(camera, false, 0, false);
    expect(adaptation.getDominantLabel()).toBe('Titan');
  });

  it('snaps on the first frame — a fresh scene must not fade up', () => {
    const bodies = [body({ appMag: -25, diameterPx: 600, label: 'Venus' })];
    const { adaptation, camera } = harness(bodies);
    const first = adaptation.measure(camera, false, 0, false);
    expect(first).toBeLessThan(-10);
    // And the same on re-entry from chart, which drops the slew's state.
    adaptation.measure(camera, true, 16, false);
    expect(adaptation.measure(camera, false, 32, false)).toBeCloseTo(first, 9);
  });

  it('ramps over the time constant, settles, and snaps through a warp', () => {
    const bodies = [body({ appMag: -25, diameterPx: 600, label: 'Venus' })];
    const { adaptation, camera } = harness(bodies);
    const deep = adaptation.measure(camera, false, 0, false);
    bodies.length = 0;
    // One τ of 60 Hz frames covers 1 − 1/e of the way back to zero, and
    // never overshoots on the way.
    let t = 0;
    let prev = deep;
    for (; t < ADAPT_SLEW_TAU_S * 1000; t += 1000 / 60) {
      const dm = adaptation.measure(camera, false, t, false);
      expect(dm).toBeGreaterThanOrEqual(prev);
      prev = dm;
    }
    expect(adaptation.getDm() / deep).toBeCloseTo(Math.exp(-1), 1);
    // It reaches exactly 0 rather than approaching it forever, which is
    // what lets the adapted-to label drop.
    for (let i = 0; i < 600; i++) {
      t += 1000 / 60;
      adaptation.measure(camera, false, t, false);
    }
    expect(adaptation.getDm()).toBe(0);
    expect(adaptation.getDominantLabel()).toBeNull();
  });

  it('bypasses the slew while warping', () => {
    const bodies = [body({ appMag: -25, diameterPx: 600, label: 'Venus' })];
    const { adaptation, camera } = harness(bodies);
    expect(adaptation.measure(camera, false, 0, false)).toBeLessThan(-10);
    bodies.length = 0;
    // The camera is somewhere else entirely by the next frame, so ramping
    // from the old scene's cut would read as a flash.
    expect(adaptation.measure(camera, false, 16, true)).toBe(0);
  });

  it('drops a body that has slid off-frame', () => {
    const off = body({ appMag: -20, screenX: -50, screenY: -50 });
    const { adaptation, camera } = harness([off]);
    expect(adaptation.measure(camera, false, 0, false)).toBe(0);
  });

  it('names the brightest source, not the last one seen', () => {
    const { adaptation, camera } = harness([
      body({ appMag: -20, label: 'Jupiter' }),
      body({ appMag: -25, label: 'Venus' }),
      body({ appMag: -10, label: 'Mars' }),
    ]);
    adaptation.measure(camera, false, 0, false);
    expect(adaptation.getDominantLabel()).toBe('Venus');
  });

  it('withholds the label while nothing is adapting', () => {
    // Bright enough to be the dominant source, far too faint to cut.
    const { adaptation, camera } = harness([body({ appMag: -4.4, label: 'Venus' })]);
    expect(adaptation.measure(camera, false, 0, false)).toBe(0);
    expect(adaptation.getMeanLuminance()).toBeGreaterThan(DIFFUSE_FIELD_L);
    expect(adaptation.getDominantLabel()).toBeNull();
  });

  it('measures nothing in chart mode and leaves no stale cut behind', () => {
    const { adaptation, camera } = harness([body({ appMag: -25, label: 'Venus' })]);
    expect(adaptation.measure(camera, false, 0, false)).toBeLessThan(-10);
    expect(adaptation.measure(camera, true, 0, false)).toBe(0);
    expect(adaptation.getDm()).toBe(0);
    expect(adaptation.getMeanLuminance()).toBe(0);
    expect(adaptation.getDominantLabel()).toBeNull();
  });

  it('adapts to a close star — the flux gate, not resolvedness', () => {
    // Sol at 100 AU: a third of a pixel wide, 1036× over the anchor.
    const sol = { pc: 100 * 4.8481368e-6, appMag: -16.74, label: 'Sol' };
    const { adaptation, camera } = harness([], [sol]);
    const dm = adaptation.measure(camera, false, 0, false);
    const expected = luminanceForMagnitude(EXPOSURE, sol.appMag) / (W * H);
    expect(expected / L_ADAPT).toBeCloseTo(1036, 0);
    // A point source is below the handover coverage by construction, so
    // the perception branch governs and the star is allowed to clip.
    expect(dm).toBeCloseTo(eyeAdaptationDm(expected + DIFFUSE_FIELD_L), 9);
    expect(dm).toBeGreaterThan(highlightGuardDm(adaptation.getPeakLuminance()));
    expect(adaptation.getDominantLabel()).toBe('Sol');
  });

  it('skips every star below the flux gate', () => {
    const windowPc = starAdaptationWindowPc(EXPOSURE, W * H);
    const gateMag = negligibleAppMag(EXPOSURE, W * H);
    const field = Array.from({ length: 200 }, (_, i) => ({
      pc: 0.1 + 0.01 * i,
      appMag: gateMag + 0.5,
      label: `star ${i}`,
    }));
    expect(field.every((s) => s.pc < windowPc)).toBe(true);
    const { adaptation, camera } = harness([], field);
    expect(adaptation.measure(camera, false, 0, false)).toBe(0);
    expect(adaptation.getMeanLuminance()).toBe(DIFFUSE_FIELD_L);
  });

  it('fades a star out at the window bound instead of popping', () => {
    const windowPc = starAdaptationWindowPc(EXPOSURE, W * H);
    const magAt = (pc: number) => -14 + 5 * (Math.log10(pc) - 1);
    const dmAt = (pc: number) => {
      const { adaptation, camera } = harness([], [{ pc, appMag: magAt(pc), label: 'giant' }]);
      return adaptation.measure(camera, false, 0, false);
    };
    // A source bright enough to matter at the bound leaves continuously.
    expect(dmAt(windowPc * 0.999)).toBeCloseTo(0, 6);
    expect(dmAt(windowPc * 1.001)).toBe(0);
    expect(dmAt(windowPc * 0.9)).toBeLessThan(dmAt(windowPc * 0.95));
    expect(dmAt(windowPc * 0.7)).toBeLessThan(dmAt(windowPc * 0.9));
  });
});
