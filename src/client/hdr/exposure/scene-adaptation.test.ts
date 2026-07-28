import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { RenderedSizeComponents } from '../../camera/controls/star-physics';
import { luminanceForMagnitude } from '../emission-pure';
import { exposureForMagLimit } from './exposure-epoch';
import { SceneAdaptation, type SceneAdaptationDeps } from './scene-adaptation';
import {
  adaptationDm,
  DIFFUSE_FIELD_L,
  L_ADAPT,
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
    fluxScale: 1,
    label: null,
    ...patch,
  };
}

describe('SceneAdaptation', () => {
  it('reports no cut on an empty dark frame', () => {
    const { adaptation, camera } = harness([]);
    expect(adaptation.measure(camera, false)).toBe(0);
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
    const dm = adaptation.measure(camera, false);
    expect(dm).toBeCloseTo(adaptationDm(surfaceL * coverage + DIFFUSE_FIELD_L), 9);
    expect(dm).toBeCloseTo(-14.32, 2);
    expect(adaptation.getDominantLabel()).toBe('Venus');
  });

  it('takes the eclipse dim as a real flux loss', () => {
    const lit = body({ appMag: -20, label: 'Io' });
    const eclipsed = body({ appMag: -20, fluxScale: 0.01, label: 'Io' });
    const a = harness([lit]);
    const b = harness([eclipsed]);
    const dmLit = a.adaptation.measure(a.camera, false);
    const dmEclipsed = b.adaptation.measure(b.camera, false);
    expect(dmLit - dmEclipsed).toBeCloseTo(-5, 3);
  });

  it('drops a body that has slid off-frame', () => {
    const off = body({ appMag: -20, screenX: -50, screenY: -50 });
    const { adaptation, camera } = harness([off]);
    expect(adaptation.measure(camera, false)).toBe(0);
  });

  it('names the brightest source, not the last one seen', () => {
    const { adaptation, camera } = harness([
      body({ appMag: -20, label: 'Jupiter' }),
      body({ appMag: -25, label: 'Venus' }),
      body({ appMag: -10, label: 'Mars' }),
    ]);
    adaptation.measure(camera, false);
    expect(adaptation.getDominantLabel()).toBe('Venus');
  });

  it('withholds the label while nothing is adapting', () => {
    // Bright enough to be the dominant source, far too faint to cut.
    const { adaptation, camera } = harness([body({ appMag: -4.4, label: 'Venus' })]);
    expect(adaptation.measure(camera, false)).toBe(0);
    expect(adaptation.getMeanLuminance()).toBeGreaterThan(DIFFUSE_FIELD_L);
    expect(adaptation.getDominantLabel()).toBeNull();
  });

  it('measures nothing in chart mode and leaves no stale cut behind', () => {
    const { adaptation, camera } = harness([body({ appMag: -25, label: 'Venus' })]);
    expect(adaptation.measure(camera, false)).toBeLessThan(-10);
    expect(adaptation.measure(camera, true)).toBe(0);
    expect(adaptation.getDm()).toBe(0);
    expect(adaptation.getMeanLuminance()).toBe(0);
    expect(adaptation.getDominantLabel()).toBeNull();
  });

  it('adapts to a close star — the flux gate, not resolvedness', () => {
    // Sol at 100 AU: a third of a pixel wide, 473× over the anchor.
    const sol = { pc: 100 * 4.8481368e-6, appMag: -16.74, label: 'Sol' };
    const { adaptation, camera } = harness([], [sol]);
    const dm = adaptation.measure(camera, false);
    const expected = luminanceForMagnitude(EXPOSURE, sol.appMag) / (W * H);
    expect(expected / L_ADAPT).toBeCloseTo(473, 0);
    expect(dm).toBeCloseTo(adaptationDm(expected + DIFFUSE_FIELD_L), 9);
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
    expect(adaptation.measure(camera, false)).toBe(0);
    expect(adaptation.getMeanLuminance()).toBe(DIFFUSE_FIELD_L);
  });

  it('fades a star out at the window bound instead of popping', () => {
    const windowPc = starAdaptationWindowPc(EXPOSURE, W * H);
    const magAt = (pc: number) => -14 + 5 * (Math.log10(pc) - 1);
    const dmAt = (pc: number) => {
      const { adaptation, camera } = harness([], [{ pc, appMag: magAt(pc), label: 'giant' }]);
      return adaptation.measure(camera, false);
    };
    // A source bright enough to matter at the bound leaves continuously.
    expect(dmAt(windowPc * 0.999)).toBeCloseTo(0, 6);
    expect(dmAt(windowPc * 1.001)).toBe(0);
    expect(dmAt(windowPc * 0.9)).toBeLessThan(dmAt(windowPc * 0.95));
    expect(dmAt(windowPc * 0.7)).toBeLessThan(dmAt(windowPc * 0.9));
  });
});
