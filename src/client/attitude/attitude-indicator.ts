// A gyro-sphere attitude indicator driven by the camera quaternion against a
// reference frame that follows the focused object, with click-to-level.

import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { BALL_DARK, BALL_LIGHT, createAttitudeBall } from './attitude-ball';
import {
  BALL_PX,
  BALL_R,
  BALL_RASTER_PX,
  BANK_TICK_MAX_LEN,
  BEZEL_GAP,
  BOX,
  C,
} from './attitude-layout';
import {
  autoFrameFor,
  buildReferenceFrames,
  captureOrbitFrame,
  captureReferenceFrame,
  captureTargetFrame,
  frameAvailableFor,
  nextFrameKey,
  readAttitude,
  type Attitude,
  type AutoFrameKey,
  type ReferenceFrame,
} from './attitude-pure';
import { focusFrameInputs } from './focus-frame';
import { coordSphereNorthPole } from '../galactic/coord-spheres/coord-sphere-frames';
import { focusedOrbitInto, type FocusedOrbit } from './orbit-frame/orbit-plane';
import type { Target } from '../camera/focus/focus-target';
import {
  DBL_CLICK_DIST_PX_SQ,
  DBL_CLICK_MS,
  PendingClickDispatcher,
} from '../util/pending-click';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Roll is unbounded out here, so the scale runs the whole way round rather
// than covering the shallow band an aircraft lives in.
const BANK_TICK_STEP_DEG = 5;

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function buildShading() {
  const defs = el('defs');

  const rim = el('radialGradient', { id: 'ai-rim', cx: '50%', cy: '50%', r: '50%' });
  rim.appendChild(el('stop', { offset: '55%', 'stop-color': '#000', 'stop-opacity': 0 }));
  rim.appendChild(el('stop', { offset: '86%', 'stop-color': '#000', 'stop-opacity': 0.22 }));
  rim.appendChild(el('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': 0.72 }));
  defs.appendChild(rim);

  const gloss = el('radialGradient', { id: 'ai-gloss', cx: '50%', cy: '50%', r: '50%' });
  gloss.appendChild(el('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': 0.34 }));
  gloss.appendChild(el('stop', { offset: '100%', 'stop-color': '#fff', 'stop-opacity': 0 }));
  defs.appendChild(gloss);

  const g = el('g');
  g.appendChild(defs);
  g.appendChild(el('circle', { cx: C, cy: C, r: BALL_R, fill: 'url(#ai-rim)' }));
  g.appendChild(
    el('ellipse', {
      cx: C - BALL_R * 0.34,
      cy: C - BALL_R * 0.4,
      rx: BALL_R * 0.42,
      ry: BALL_R * 0.32,
      fill: 'url(#ai-gloss)',
    }),
  );
  return g;
}

function bankTick(deg: number) {
  if (deg % 90 === 0) return { len: BANK_TICK_MAX_LEN, width: 3 };
  if (deg % 30 === 0) return { len: 8.5, width: 2.4 };
  if (deg % 10 === 0) return { len: 5.5, width: 1.8 };
  return { len: 3.5, width: 1.4 };
}

function buildBezel() {
  const g = el('g');
  const inner = BALL_R + BEZEL_GAP;
  for (let d = 0; d < 360; d += BANK_TICK_STEP_DEG) {
    const { len, width } = bankTick(d);
    const rad = ((d - 90) * Math.PI) / 180;
    g.appendChild(
      el('line', {
        x1: C + Math.cos(rad) * inner,
        y1: C + Math.sin(rad) * inner,
        x2: C + Math.cos(rad) * (inner + len),
        y2: C + Math.sin(rad) * (inner + len),
        class: 'ai-bank-tick',
        'stroke-width': width,
      }),
    );
  }
  g.appendChild(el('circle', { cx: C, cy: C, r: BALL_R + 1, class: 'ai-bezel' }));
  return g;
}

/** The fixed index amber. Like the caret below it is read against the ball,
 *  never the page, so it stays put when the page palette flips.
 *
 *  It clears 9.5:1 against the dark hemisphere and only 1.8:1 against the
 *  light one — and no warm colour clears the 3:1 a non-text graphic wants on
 *  both, warmth being brightness. The outline below is what carries it. */
const INDEX_AMBER = '#ff9d0a';

const SYMBOL_STROKE = 2.2;
const SYMBOL_DOT_R = 2.4;
/** Half-width of the cross's outline, in the 192-unit design space — about a
 *  pixel once CSS stretches the box. `BALL_DARK` against the light hemisphere
 *  is 16.9:1, so a hairline is the whole fix; anything heavier reads as a
 *  second graphic rather than an edge. */
const SYMBOL_OUTLINE = 0.75;

/** A cross rather than aircraft wings: four arms and a centre point, scaled
 *  off the ball and trimmed 5%. Drawn twice — the dark outline beneath the
 *  amber — because the amber alone vanishes over the light hemisphere. */
function buildSymbol() {
  const g = el('g', { class: 'ai-symbol' });
  const inner = BALL_R * 0.163;
  const outer = inner + (BALL_R * 0.489 - inner) * 0.95;
  const arms = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (const [colour, width, dotR] of [
    [BALL_DARK, SYMBOL_STROKE + 2 * SYMBOL_OUTLINE, SYMBOL_DOT_R + SYMBOL_OUTLINE],
    [INDEX_AMBER, SYMBOL_STROKE, SYMBOL_DOT_R],
  ] as const) {
    const layer = el('g', { stroke: colour, 'stroke-width': width, 'stroke-linecap': 'round' });
    for (const [dx, dy] of arms) {
      layer.appendChild(
        el('line', {
          x1: C + dx * inner,
          y1: C + dy * inner,
          x2: C + dx * outer,
          y2: C + dy * outer,
        }),
      );
    }
    layer.appendChild(el('circle', { cx: C, cy: C, r: dotR, fill: colour, stroke: 'none' }));
    g.appendChild(layer);
  }
  return g;
}

/** The FDAI roll caret: a light **equilateral** triangle carrying a narrow dark
 *  **isoceles** one on the same base line. The dark triangle is a little over a
 *  third as wide and all but as tall, so the light reads as an outline that
 *  thickens toward the base corners and closes over a hairline gap at the tip.
 *  Scaling a second equilateral inside the first is the wrong shape — it leaves
 *  an even border instead. */
const CARET_HALF_BASE = 8;
const INSET_BASE_FRAC = 0.36;
const INSET_HEIGHT_FRAC = 0.99;

function buildBankPointer() {
  const g = el('g');
  const tip = C - BALL_R + 1;
  const height = CARET_HALF_BASE * Math.sqrt(3);
  const base = tip + height;
  const inset = CARET_HALF_BASE * INSET_BASE_FRAC;
  g.appendChild(
    el('polygon', {
      points: `${C},${tip} ${C - CARET_HALF_BASE},${base} ${C + CARET_HALF_BASE},${base}`,
      fill: BALL_LIGHT,
    }),
  );
  g.appendChild(
    el('polygon', {
      points: `${C},${base - height * INSET_HEIGHT_FRAC} ${C - inset},${base} ${C + inset},${base}`,
      fill: BALL_DARK,
    }),
  );
  return g;
}

/** A chip in one of the square's free corners, outside the disc-clipped
 *  stage. `variant` places it and carries nothing else. */
function cornerChip(variant: string, label: string, title: string) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `attitude-chip ${variant}`;
  btn.textContent = label;
  btn.title = title;
  return btn;
}

export interface AttitudeIndicator {
  /** Zero the roll against the active frame. Bound to a click on the ball and
   *  to the `L` shortcut. */
  level(): void;
  /** Capture the focused object's own orbital plane as the ORB frame and
   *  level on it. A double-click on the ball or `Shift`+`L`; a no-op when
   *  nothing focused rides an orbit the model has elements for. */
  levelOnOrbit(): void;
  /** Step the reference frame on. The corner flag's click, and `S` in
   *  navigate — where the ball is what a frame change moves. */
  cycleFrame(): void;
}

export function createAttitudeIndicator(stellata: Stellata): AttitudeIndicator | null {
  const host = document.getElementById('attitude');
  if (host === null) return null;
  host.innerHTML = '';
  // The instrument fills its panel column, so the one number the stylesheet
  // cannot derive is the ball's share of the square box it sits in. Every
  // rule consuming it is a class in styles.css — README.md § Sizing.
  host.style.setProperty('--ai-ball-frac', String(BALL_PX / BOX));
  // The REF chip lights in the index cross's own colour, so the stylesheet
  // takes it from the constant above rather than keeping a second copy that
  // could drift off the thing it is supposed to match.
  host.style.setProperty('--ai-index', INDEX_AMBER);
  host.style.setProperty('--ai-index-ink', BALL_DARK);

  const panel = document.getElementById('instruments');
  const section = host.closest('.group');

  /** Nothing on screen to draw into. `display: none` suppresses the composite
   *  but not the draw, so every way the instrument can be hidden — the mode,
   *  `U`, and either collapse — has to be answered here or the mini renderer
   *  keeps painting a sphere nobody can see. */
  function offScreen(): boolean {
    if (document.body.hasAttribute('data-controls-hidden')) return true;
    if (panel !== null && (panel.hidden || panel.classList.contains('collapsed'))) {
      return true;
    }
    return section !== null && section.classList.contains('collapsed');
  }

  const frames = buildReferenceFrames();
  let focused: Target | null = stellata.focus.getFocusedTarget();
  // ORB and REF are captured from a gesture rather than chosen off the table,
  // so the instrument holds them; every other frame is `filter.coordSphere`,
  // which `S` and the panel write too. The ball can never read against
  // nothing, so an unselected grid resolves to the focus default.
  let captured: ReferenceFrame | null = null;

  function selectedFrameKey(): AutoFrameKey {
    const selected = stellata.filters.getFilter().coordSphere;
    return selected === 'none'
      ? autoFrameFor(focusFrameInputs(stellata, focused))
      : selected;
  }

  function resolveFrame(): ReferenceFrame {
    return captured ?? frames[selectedFrameKey()];
  }

  let frame: ReferenceFrame = resolveFrame();

  const ball = createAttitudeBall(BALL_RASTER_PX);

  const stage = document.createElement('div');
  stage.className = 'attitude-stage';
  ball.canvas.className = 'ai-canvas';
  stage.appendChild(ball.canvas);

  const svg = el('svg', { class: 'ai-chrome', viewBox: `0 0 ${BOX} ${BOX}` });
  svg.appendChild(buildShading());
  svg.appendChild(buildBezel());
  const bankPointer = buildBankPointer();
  svg.appendChild(bankPointer);
  svg.appendChild(buildSymbol());
  stage.appendChild(svg);

  const refBtn = cornerChip(
    'attitude-ref',
    'REF',
    'Datum — off, then REF (the attitude held right now), '
      + 'then TGT (zero longitude on the destination)',
  );
  const frameBtn = cornerChip(
    'attitude-frame',
    frame.label,
    'Reference frame — click to cycle',
  );
  const invertBtn = cornerChip(
    'attitude-invert',
    'INV',
    'Invert the view — swing around to the far side of the focused object',
  );
  host.appendChild(stage);
  // Outside the stage, which is clipped to its disc so the square's corners
  // stay clicks on the sky. The chips sit in three of those corners.
  host.appendChild(refBtn);
  host.appendChild(frameBtn);
  host.appendChild(invertBtn);

  const attitude: Attitude = { pitchRad: 0, bankRad: 0, lonRad: 0, sinFromPole: 1 };
  const lastQuat = new THREE.Quaternion(2, 2, 2, 2);
  // Set while the instrument is off screen so the ball catches up on the
  // first frame after it comes back, rather than showing a stale attitude.
  let missedWhileHidden = false;

  function draw() {
    const camera = stellata.camera;
    lastQuat.copy(camera.quaternion);
    ball.render(camera, frame);
    readAttitude(camera, frame, attitude);
    const bankDeg = (attitude.bankRad * 180) / Math.PI;
    bankPointer.setAttribute('transform', `rotate(${bankDeg.toFixed(2)} ${C} ${C})`);
  }

  /** Re-resolve after anything that could have moved the frame. Identity is
   *  the whole test: a table frame is the same object until the selection
   *  changes, and a capture is always a fresh one. */
  /** Which of the chip's three stops is showing. A captured ORB is not one of
   *  them — that datum belongs to the flag. */
  function datumStop(): 'off' | 'reference' | 'target' {
    if (captured?.key === 'reference') return 'reference';
    if (captured?.key === 'target') return 'target';
    return 'off';
  }

  function refresh() {
    // Neither datum has a place on the flag, so the flag keeps reading the
    // frame underneath and the chip alone says one is held.
    const stop = datumStop();
    refBtn.textContent = stop === 'target' ? 'TGT' : 'REF';
    refBtn.classList.toggle('on', stop !== 'off');
    refBtn.setAttribute('aria-pressed', stop !== 'off' ? 'true' : 'false');
    const next = resolveFrame();
    if (next === frame) return;
    frame = next;
    frameBtn.textContent = stop === 'off' ? frame.label : frames[selectedFrameKey()].label;
    draw();
  }

  function capture(next: ReferenceFrame) {
    captured = next;
    refresh();
  }

  function level() {
    if (stellata.isCameraTransitionActive()) return;
    const camera = stellata.camera;
    const roll = stellata.roll;
    if (stellata.focus.getCameraMode() === 'observe') {
      // The instrument is not on screen here, so the drawn grid is what the
      // user is levelling against — and with none up there is nothing to
      // level to, rather than a hidden frame to guess at.
      const selected = stellata.filters.getFilter().coordSphere;
      if (selected === 'none') return;
      const pole = coordSphereNorthPole(selected);
      roll.rollQuaternion(camera, roll.renderedRollError(camera, pole));
      return;
    }
    roll.levelTo(camera, frame.pole);
    draw();
  }

  const orbit: FocusedOrbit = {
    normal: new THREE.Vector3(),
    toCentre: new THREE.Vector3(),
  };

  function levelOnOrbit() {
    // ORB is the instrument's frame, and the instrument is navigate-only.
    if (stellata.focus.getCameraMode() === 'observe') return;
    if (!focusedOrbitInto(orbit, stellata, focused)) return;
    capture(captureOrbitFrame(stellata.camera, orbit.normal, orbit.toCentre));
    level();
  }

  const clicks = new PendingClickDispatcher(
    DBL_CLICK_MS,
    DBL_CLICK_DIST_PX_SQ,
    level,
    levelOnOrbit,
  );

  stage.addEventListener('click', (e) => clicks.click(e.clientX, e.clientY));
  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    capture(captureReferenceFrame(stellata.camera));
  });
  stage.setAttribute('role', 'img');
  stage.setAttribute('aria-label', 'Attitude indicator');
  stage.title = 'Click to level · double-click to level on the focused orbit '
    + '· right-click to set REF here';

  function cycleFrame() {
    const hasOrbit = focusedOrbitInto(orbit, stellata, focused);
    const inputs = focusFrameInputs(stellata, focused);
    const next = nextFrameKey(
      frame.key,
      autoFrameFor(inputs),
      hasOrbit,
      (candidate) => frameAvailableFor(candidate, inputs),
    );
    // Cycling into ORB captures the plane exactly as the gesture does, but
    // does not level on it: the flag chooses what the ball reads against,
    // and levelling is the gesture's own half of the job.
    if (next === 'orbit') {
      capture(captureOrbitFrame(stellata.camera, orbit.normal, orbit.toCentre));
      return;
    }
    captured = null;
    stellata.filters.setFilter({ coordSphere: next });
    refresh();
  }

  frameBtn.addEventListener('click', cycleFrame);

  const destination = new THREE.Vector3();

  /** Direction from the camera to the distance-vector destination, or null
   *  when there is none or its position will not resolve — an object whose
   *  artifact has not attached answers false rather than a stale point. */
  function toDestination(): THREE.Vector3 | null {
    const to = stellata.focus.getVectorTarget();
    if (to === null) return null;
    if (!stellata.focusables[to.kind].localPositionInto(to.idx, destination)) return null;
    destination.sub(stellata.camera.position);
    return destination.lengthSq() > 0 ? destination : null;
  }

  // off → REF → TGT → off, and TGT is skipped outright with no destination
  // set rather than offered as a stop that does nothing. Cycling rather than
  // toggling is what keeps one control the whole mechanism: every datum is
  // armed and cleared here, and none is stranded outside the flag's rotation.
  refBtn.addEventListener('click', () => {
    const stop = datumStop();
    if (stop === 'target') {
      captured = null;
      refresh();
      return;
    }
    if (stop === 'reference') {
      const dir = toDestination();
      if (dir === null) {
        captured = null;
        refresh();
        return;
      }
      capture(captureTargetFrame(stellata.camera, dir));
      return;
    }
    capture(captureReferenceFrame(stellata.camera));
  });

  invertBtn.addEventListener('click', () => stellata.invertView());

  // A captured datum belongs to the object it was taken on: ORB reads a plane
  // that object rides and REF an attitude held while looking at it, so neither
  // survives the focus moving. The table frames do — the shell demotes the
  // selection only when the new focus takes its meaning away.
  stellata.on('focus', (target) => {
    focused = target;
    clicks.cancel();
    captured = null;
    refresh();
  });

  // Choosing a frame clears whatever datum was held — the chip returns to its
  // off stop rather than leaving the ball reading a datum the user has just
  // selected past. Watching the value rather than each writer is what makes
  // that true of the panel and a URL restore as well as of `S` and the flag.
  let lastSelected = stellata.filters.getFilter().coordSphere;
  stellata.on('filter', () => {
    const selected = stellata.filters.getFilter().coordSphere;
    if (selected !== lastSelected) {
      lastSelected = selected;
      captured = null;
    }
    refresh();
  });

  // The instrument is navigate-only: observe has the drawn grid instead, and
  // two answers to "which way is north" on screen at once is what let the
  // roll guide and this disagree. The whole panel goes, not just the ball —
  // an Instruments box holding nothing reads as a fault.
  const applyModeVisibility = () => {
    if (panel !== null) panel.hidden = stellata.focus.getCameraMode() === 'observe';
  };
  stellata.on('cameraMode', applyModeVisibility);
  applyModeVisibility();

  stellata.on('frame', () => {
    const moved = !lastQuat.equals(stellata.camera.quaternion);
    if (offScreen()) {
      missedWhileHidden = missedWhileHidden || moved;
      return;
    }
    if (!moved && !missedWhileHidden) return;
    missedWhileHidden = false;
    draw();
  });

  draw();
  return { level, levelOnOrbit, cycleFrame };
}
