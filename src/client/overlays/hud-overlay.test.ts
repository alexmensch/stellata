import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applyFade } from './dirty-attr';
import { emptyArrowState, resetArrowSentinels, HudOverlay, type ArrowState } from './hud-overlay';
import { fmtDistAuto } from '../ui/distance-util';
import { AU_PC } from '../util/astronomy-constants';

function makeFadeEls() {
  const style = {} as Record<string, string>;
  const el = {
    style: style as unknown as CSSStyleDeclaration,
    setAttribute: vi.fn(),
  } as unknown as SVGPathElement & SVGTextElement;
  return { el, style };
}

describe('hud-overlay applyFade', () => {
  it('writes opacity to all three elements on the first call from a fresh state', () => {
    // Regression test for the original sentinel-init bug where
    // `lastOpacity: NaN` poisoned applyFade's early-write gate
    // (`Math.abs(α − NaN) = NaN; NaN >= 0.0005 = false`) and silently
    // skipped every opacity write — leaving the Sol/GC arrows pinned at
    // the CSS default opacity (no fade). emptyArrowState() must produce
    // a sentinel that fails the `>= 0.0005` comparison so the write
    // lands. -Infinity satisfies that; NaN does not.
    const path = makeFadeEls();
    const bg = makeFadeEls();
    const label = makeFadeEls();
    const state = emptyArrowState();
    applyFade([path.el, bg.el, label.el], label.el, 0.5, state);
    expect(path.style.opacity).toBe('0.500');
    expect(bg.style.opacity).toBe('0.500');
    expect(label.style.opacity).toBe('0.500');
    expect(state.lastOpacity).toBe(0.5);
  });

  it('skips opacity writes when alpha is within 0.0005 of last', () => {
    const path = makeFadeEls();
    const bg = makeFadeEls();
    const label = makeFadeEls();
    const state = emptyArrowState();
    applyFade([path.el, bg.el, label.el], label.el, 0.5, state);
    path.style.opacity = 'sentinel'; // overwrite to detect a re-write
    bg.style.opacity = 'sentinel';
    label.style.opacity = 'sentinel';
    applyFade([path.el, bg.el, label.el], label.el, 0.5001, state);
    expect(path.style.opacity).toBe('sentinel');
    expect(bg.style.opacity).toBe('sentinel');
    expect(label.style.opacity).toBe('sentinel');
  });

  it('toggles label pointer-events at the 0.5 alpha threshold', () => {
    const path = makeFadeEls();
    const bg = makeFadeEls();
    const label = makeFadeEls();
    const state = emptyArrowState();
    applyFade([path.el, bg.el, label.el], label.el, 1.0, state);
    expect(label.style.pointerEvents).toBe('');
    expect(state.lastPointerEvents).toBe('');
    applyFade([path.el, bg.el, label.el], label.el, 0.3, state);
    expect(label.style.pointerEvents).toBe('none');
    expect(state.lastPointerEvents).toBe('none');
  });

  it('resetArrowSentinels wipes every per-attribute sentinel back to its poison-init value', () => {
    // hideArrow must wipe the numeric / text /
    // opacity / pointer-events sentinels, not just the visible d / display
    // pair. Without this, the next show-from-hide cycle would inherit
    // stale cx/cy/lx/ly from the prior visible session whenever the new
    // coords fell within ATTR_DIRTY_PX of them — silently skipping the
    // first-frame setAttribute and pinning the label to its old position.
    const populated: ArrowState = {
      lastD: 'M250,100L300,150',
      lastLabelDisplay: '',
      lastLabelText: 'Sol · 4.2 pc',
      lastLabelX: 312,
      lastLabelY: 96,
      lastOpacity: 0.7,
      lastPointerEvents: '',
    };
    resetArrowSentinels(populated);
    // Numeric sentinels return to NaN (any real value differs).
    expect(Number.isNaN(populated.lastLabelX)).toBe(true);
    expect(Number.isNaN(populated.lastLabelY)).toBe(true);
    // String + opacity sentinels return to their canonical poisons.
    expect(populated.lastLabelText).toBe('\0');
    expect(populated.lastOpacity).toBe(-Infinity);
    expect(populated.lastPointerEvents).toBe('\0');
    // d + display are NOT reset — they ride the dirty-attr gate so the
    // hide-state value (set elsewhere in hideArrow) stays as the cached
    // last value.
    expect(populated.lastD).toBe('M250,100L300,150');
    expect(populated.lastLabelDisplay).toBe('');
  });

  it("first pointer-events write lands from poison '\\0' sentinel even when alpha=1 yields ''", () => {
    // Regression test for the original case where
    // `lastPointerEvents: ''` matched the steady-state derived value and
    // the first restore-to-clickable write was skipped. The fresh sentinel
    // must be poison ('\0') so the first apply writes through.
    const path = makeFadeEls();
    const bg = makeFadeEls();
    const label = makeFadeEls();
    const state = emptyArrowState();
    expect(state.lastPointerEvents).toBe('\0');
    applyFade([path.el, bg.el, label.el], label.el, 1.0, state);
    expect(label.style.pointerEvents).toBe('');
    expect(state.lastPointerEvents).toBe('');
  });
});

describe('HudOverlay.update distance labels', () => {
  function makeSvgStub() {
    return {
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      textContent: null as string | null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  }

  it('Sol label reads in AU when observing 1 AU from Sol (planet-anchored observe)', () => {
    // Regression pair from the planet-as-object smoke: (a) the caller
    // must feed the focal object's position as the measurement origin —
    // controls.target sits 1 pc ahead of the camera in observe, which
    // rendered "Sol · 3.3 ly" from Earth; (b) the label must format via
    // fmtDistAuto so the AU tier engages below AU_SWITCH_PC.
    const ring = makeSvgStub();
    const solPath = makeSvgStub();
    const solBg = makeSvgStub();
    const gcPath = makeSvgStub();
    const gcBg = makeSvgStub();
    const solLabel = makeSvgStub();
    const gcLabel = makeSvgStub();
    const hud = new HudOverlay(
      ring as unknown as SVGCircleElement,
      solPath as unknown as SVGPathElement,
      solBg as unknown as SVGPathElement,
      gcPath as unknown as SVGPathElement,
      gcBg as unknown as SVGPathElement,
      solLabel as unknown as SVGTextElement,
      gcLabel as unknown as SVGTextElement,
      () => {},
      () => {},
    );

    // Observe parked on a planet 1 AU from Sol: floating origin on the
    // planet (worldOffset = planet abs pos), camera at the local origin
    // looking AWAY from Sol so the Sol arrow draws at full length.
    const camera = new THREE.PerspectiveCamera(60, 800 / 600, 1e-10, 1000);
    camera.position.set(0, 0, 0);
    // Sol sits at (-1 AU, 0, 0); look away-and-off-axis so it's behind
    // the camera but NOT exactly anti-parallel (that measure-zero
    // orientation legitimately hides the arrow).
    camera.lookAt(1, 0, -1);
    camera.updateMatrixWorld();

    hud.update({
      enabled: true,
      camera,
      target: new THREE.Vector3(1, 0, 0), // 1 pc ahead — must NOT be the origin
      worldOffset: new THREE.Vector3(AU_PC, 0, 0),
      focusedLocal: new THREE.Vector3(0, 0, 0), // the observed planet
      hideSolArrow: false,
      sizeMaxPx: 8,
      cameraMode: 'observe',
      transition: null,
      focusedDiscRadiusPx: 0,
      w: 800,
      h: 600,
    });

    expect(solLabel.textContent).toBe(`Sol · ${fmtDistAuto(AU_PC)}`);
    expect(solLabel.textContent).toContain('AU');
    expect(solLabel.textContent).not.toContain('ly');
  });
});
