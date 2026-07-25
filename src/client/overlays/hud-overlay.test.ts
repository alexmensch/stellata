import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applyFade } from './dirty-attr';
import {
  computeShaftStartRadius,
  emptyArrowState,
  resetArrowSentinels,
  HudOverlay,
  type ArrowState,
} from './hud-overlay';
import { discCoverageAlpha } from './arrow-fade';
import { ARROW_PIXEL_LENGTH } from './arrow-path';
import { FOCUS_RING_RADIUS_PX } from './focus-ring-overlay';
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

function makeSvgStub() {
  return {
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    textContent: null as string | null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
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

describe('HudOverlay two-pass alpha sequencing', () => {
  function makeHud() {
    const els = {
      ring: makeSvgStub(),
      solPath: makeSvgStub(),
      solBg: makeSvgStub(),
      gcPath: makeSvgStub(),
      gcBg: makeSvgStub(),
      solLabel: makeSvgStub(),
      gcLabel: makeSvgStub(),
    };
    const hud = new HudOverlay(
      els.ring as unknown as SVGCircleElement,
      els.solPath as unknown as SVGPathElement,
      els.solBg as unknown as SVGPathElement,
      els.gcPath as unknown as SVGPathElement,
      els.gcBg as unknown as SVGPathElement,
      els.solLabel as unknown as SVGTextElement,
      els.gcLabel as unknown as SVGTextElement,
      () => {},
      () => {},
    );
    return { hud, els };
  }

  const W = 800;
  const H = 600;
  // Navigate steady state: the shaft starts at the focus-ring rim + halo gap.
  const SHAFT_START_PX = computeShaftStartRadius('navigate', null, 0);
  // Disc radius landing coverage mid-band (0.5 → 0.75 fades 1 → 0), so the
  // expected alpha is strictly between 0 and 1 — a stale-geometry alpha of
  // exactly 1 is then unambiguously distinguishable.
  const MID_BAND_COVERAGE = 0.625;
  const DISC_RADIUS_PX = SHAFT_START_PX + MID_BAND_COVERAGE * ARROW_PIXEL_LENGTH;

  // Camera at the local origin looking down −Z; the focal object sits
  // ahead of it, and Sol sits behind-and-off-axis so its arrow draws at
  // full ARROW_PIXEL_LENGTH (no shrink-to-target).
  function navigateUpdateOpts() {
    const camera = new THREE.PerspectiveCamera(60, W / H, 1e-10, 1000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    return {
      enabled: true,
      camera,
      target: new THREE.Vector3(0, 0, -5),
      worldOffset: new THREE.Vector3(-10, 0, -5), // → Sol local = (10, 0, 5)
      focusedLocal: new THREE.Vector3(0, 0, -5),
      hideSolArrow: false,
      sizeMaxPx: 0,
      cameraMode: 'navigate' as const,
      transition: null,
      focusedDiscRadiusPx: DISC_RADIUS_PX,
      w: W,
      h: H,
    };
  }

  it('pins the navigate shaft start to the focus-ring rim plus halo gap', () => {
    // The disc-coverage fixture below is keyed on this radius; if the ring
    // geometry moves, the coverage fractions move with it.
    expect(SHAFT_START_PX).toBeGreaterThan(FOCUS_RING_RADIUS_PX);
  });

  it('computes the fade alpha from THIS frame geometry on the first frame after a hide', () => {
    // ml8 symptom 1: the pre-#70 design computed the shared Sol/GC alpha
    // BEFORE committing arrow geometry, reading last frame's
    // getDrawnLengths(). On the first frame after a toggle-off (both
    // lengths latched to 0) discCoverageAlpha's `shaftLengthPx <= 0` guard
    // returned 1 — the chevrons flashed fully opaque for one frame even
    // though the focal disc already covered the shaft. The two-pass order
    // (commit geometry, then derive alpha) is what fixes it, and only an
    // integration assertion over update() can catch a regression: the
    // pure-helper guard test passes either way.
    const { hud } = makeHud();

    hud.setVisible(false); // toggle-off: latches solDrawnLen = gcDrawnLen = 0
    expect(hud.getDrawnLengths()).toEqual({ sol: 0, gc: 0 });
    expect(hud.getCurrentFadeAlpha()).toBe(1);

    hud.update(navigateUpdateOpts());

    const { sol, gc } = hud.getDrawnLengths();
    const refLen = Math.max(sol, gc);
    expect(refLen).toBeGreaterThan(0);

    const alpha = hud.getCurrentFadeAlpha();
    expect(alpha).toBe(discCoverageAlpha(DISC_RADIUS_PX, refLen, hud.getShaftStartPx()));
    // The regression's signature: reading the stale zero-length state
    // yields exactly 1, while this-frame geometry yields a partial fade.
    expect(discCoverageAlpha(DISC_RADIUS_PX, 0, hud.getShaftStartPx())).toBe(1);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });

  it('applies the shared alpha to both arrows through the fade gate', () => {
    // Sol and GC share one alpha so the chevron pair fades together; the
    // opacity actually painted must be the alpha update() derived, not a
    // per-arrow re-derivation.
    const { hud, els } = makeHud();
    hud.setVisible(false);
    hud.update(navigateUpdateOpts());

    const alpha = hud.getCurrentFadeAlpha();
    const painted = alpha.toFixed(3);
    expect(els.solPath.style.opacity).toBe(painted);
    expect(els.solBg.style.opacity).toBe(painted);
    expect(els.solLabel.style.opacity).toBe(painted);
  });
});
