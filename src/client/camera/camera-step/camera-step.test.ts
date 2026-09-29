import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { makeControlsStub } from '../camera-test-stubs';
import { TrackballSettle } from '../controls/input/trackball-settle';
import type { CameraMode } from '../focus/focus-controller';
import { CameraStep } from './camera-step';

type Active = 'warp' | 'aim' | 'focusLerp' | 'observeAim' | 'observeTransition';

function harness(opts: { active?: readonly Active[]; mode?: CameraMode } = {}) {
  const active = new Set(opts.active ?? []);
  const log: string[] = [];
  const mode = opts.mode ?? 'navigate';
  const camera = new THREE.PerspectiveCamera(50, 1, 1e-6, 1e6);
  const controls = makeControlsStub();
  controls.update.mockImplementation(() => log.push('controls.update'));
  const listeners = new Set<string>();
  const canvas = {
    addEventListener: (name: string) => listeners.add(name),
    removeEventListener: (name: string) => listeners.delete(name),
  } as unknown as HTMLElement;
  const step = new CameraStep({
    canvas,
    camera,
    controls,
    observeControls: { update: () => log.push('observeControls.update') },
    observeLookPin: { update: () => log.push('lookPin.update') },
    roll: { adoptFromCamera: () => log.push('roll.adopt') },
    warp: { isActive: () => active.has('warp'), tick: () => log.push('warp.tick') },
    aim: {
      isActive: () => active.has('aim'),
      tick: () => log.push('aim.tick'),
      isObserveAimActive: () => active.has('observeAim'),
      tickObserve: () => log.push('aim.tickObserve'),
    },
    focus: {
      getCameraMode: () => mode,
      isFocusLerpActive: () => active.has('focusLerp'),
      tick: () => log.push('focus.tick'),
    },
    observe: {
      isAnyActive: () => active.has('observeTransition'),
      tick: () => log.push('observe.tick'),
    },
    pxPerRadian: () => 1000,
    fovYRad: () => 1,
  });
  return { step, log, listeners };
}

afterEach(() => vi.restoreAllMocks());

describe('CameraStep.advance', () => {
  it.each([
    [['warp', 'aim', 'focusLerp', 'observeAim', 'observeTransition'], 'warp.tick'],
    [['aim', 'focusLerp', 'observeAim', 'observeTransition'], 'aim.tick'],
    [['focusLerp', 'observeAim', 'observeTransition'], 'focus.tick'],
    [['observeAim', 'observeTransition'], 'aim.tickObserve'],
    [['observeTransition'], 'observe.tick'],
  ] as const)('with %j active, runs only %s and reports animating', (active, tick) => {
    const { step, log } = harness({ active, mode: 'observe' });
    expect(step.advance(0)).toBe(true);
    expect(log.filter((l) => l.endsWith('tick') || l.endsWith('tickObserve'))).toEqual([tick]);
  });

  it('re-seats the look pin after the observe aim slerp', () => {
    const { step, log } = harness({ active: ['observeAim'], mode: 'observe' });
    step.advance(0);
    expect(log).toEqual(['roll.adopt', 'aim.tickObserve', 'lookPin.update']);
  });

  it('steady observe runs the look-around and pin, and is not animating', () => {
    const { step, log } = harness({ mode: 'observe' });
    expect(step.advance(0)).toBe(false);
    expect(log).toEqual(['roll.adopt', 'observeControls.update', 'lookPin.update']);
  });

  it('steady navigate brackets controls.update with the settle, and is not animating', () => {
    const capture = vi.spyOn(TrackballSettle.prototype, 'capture');
    const tick = vi.spyOn(TrackballSettle.prototype, 'tick');
    const { step, log } = harness();
    expect(step.advance(0)).toBe(false);
    expect(log).toEqual(['controls.update']);
    expect(capture.mock.invocationCallOrder[0])
      .toBeLessThan(tick.mock.invocationCallOrder[0]);
    expect(tick).toHaveBeenCalledWith(expect.anything(), 1000, 1);
  });

  it('adopts roll after a navigate animation, never on steady navigate', () => {
    const animating = harness({ active: ['warp'] });
    animating.step.advance(0);
    expect(animating.log).toEqual(['warp.tick', 'roll.adopt']);
    const steady = harness();
    steady.step.advance(0);
    expect(steady.log).not.toContain('roll.adopt');
  });

  it('adopts roll before the dispatch in observe, and not again after', () => {
    const { step, log } = harness({ active: ['observeTransition'], mode: 'observe' });
    step.advance(0);
    expect(log).toEqual(['roll.adopt', 'observe.tick']);
  });
});

describe('CameraStep lifecycle', () => {
  it('attaches the settle wake at construction and detaches on dispose', () => {
    const { step, listeners } = harness();
    expect([...listeners].sort()).toEqual(['pointerdown', 'wheel']);
    step.dispose();
    expect(listeners.size).toBe(0);
  });
});
