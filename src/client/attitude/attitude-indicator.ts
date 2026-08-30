// A gyro-sphere attitude indicator driven by the camera quaternion against a
// reference frame that follows the focused object, with click-to-level.

import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { BALL_DARK, BALL_LIGHT, createAttitudeBall } from './attitude-ball';
import {
  BALL_R,
  BALL_RASTER_PX,
  BANK_TICK_MAX_LEN,
  BEZEL_GAP,
  BOX,
  C,
  RENDERED_BOX_PX,
} from './attitude-layout';
import {
  autoFrameFor,
  buildReferenceFrames,
  captureOrbitFrame,
  captureReferenceFrame,
  nextFrameKey,
  readAttitude,
  type Attitude,
  type FocusFrameInputs,
  type ReferenceFrame,
} from './attitude-pure';
import { focusedOrbitInto, type FocusedOrbit } from './orbit-plane';
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
function focusInputs(stellata: Stellata, target: Target | null): FocusFrameInputs {
  return {
    kind: target?.kind ?? null,
    planetName:
      target?.kind === 'planet'
        ? stellata.kinds.planet?.displayName(target.idx) ?? null
        : null,
    isSol: target?.kind === 'star' && target.idx === stellata.catalog.solIndex,
  };
}

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
 *  never the page, so it stays put when the page palette flips. */
const INDEX_AMBER = '#ffd24a';

/** A cross rather than aircraft wings: four arms and a centre point, scaled
 *  off the ball and trimmed 5%. */
function buildSymbol() {
  const g = el('g', { class: 'ai-symbol', stroke: INDEX_AMBER, 'stroke-width': 2.2 });
  const inner = BALL_R * 0.163;
  const outer = inner + (BALL_R * 0.489 - inner) * 0.95;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    g.appendChild(
      el('line', {
        x1: C + dx * inner,
        y1: C + dy * inner,
        x2: C + dx * outer,
        y2: C + dy * outer,
      }),
    );
  }
  g.appendChild(el('circle', { cx: C, cy: C, r: 2.4, fill: INDEX_AMBER, stroke: 'none' }));
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
}

export function createAttitudeIndicator(stellata: Stellata): AttitudeIndicator | null {
  const host = document.getElementById('attitude');
  if (host === null) return null;
  host.hidden = false;
  host.innerHTML = '';
  // The only two numbers the stylesheet cannot derive. Every rule that
  // consumes them is a class in styles.css — README.md § Sizing.
  host.style.setProperty('--ai-box', `${RENDERED_BOX_PX}px`);
  host.style.setProperty('--ai-ball', `${BALL_RASTER_PX}px`);

  const frames = buildReferenceFrames();
  let focused: Target | null = stellata.focus.getFocusedTarget();
  let frame: ReferenceFrame = frames[autoFrameFor(focusInputs(stellata, focused))];

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

  const frameBtn = cornerChip(
    'attitude-frame',
    frame.label,
    'Reference frame — click to cycle, right-click the ball to set REF',
  );
  const invertBtn = cornerChip(
    'attitude-invert',
    'REV',
    'Invert the view — swing around to the far side of the focused object',
  );
  host.appendChild(stage);
  // Outside the stage, which is clipped to its disc so the square's corners
  // stay clicks on the sky. The chips sit in two of those corners.
  host.appendChild(frameBtn);
  host.appendChild(invertBtn);

  const attitude: Attitude = { pitchRad: 0, bankRad: 0, lonRad: 0, sinFromPole: 1 };
  const lastQuat = new THREE.Quaternion(2, 2, 2, 2);
  // `U` hides the instrument, but display:none suppresses only the composite —
  // the mini renderer would keep drawing a sphere nobody can see. Set while
  // hidden so the ball catches up on the first frame after it comes back.
  let missedWhileHidden = false;

  function draw() {
    const camera = stellata.camera;
    lastQuat.copy(camera.quaternion);
    ball.render(camera, frame);
    readAttitude(camera, frame, attitude);
    const bankDeg = (attitude.bankRad * 180) / Math.PI;
    bankPointer.setAttribute('transform', `rotate(${bankDeg.toFixed(2)} ${C} ${C})`);
  }

  function setFrame(next: ReferenceFrame) {
    frame = next;
    frameBtn.textContent = frame.label;
    draw();
  }

  function level() {
    if (stellata.isCameraTransitionActive()) return;
    const camera = stellata.camera;
    const roll = stellata.roll;
    if (stellata.focus.getCameraMode() === 'observe') {
      roll.rollQuaternion(camera, roll.renderedRollError(camera, frame.pole));
    } else {
      roll.levelTo(camera, frame.pole);
    }
    draw();
  }

  const orbit: FocusedOrbit = {
    normal: new THREE.Vector3(),
    toCentre: new THREE.Vector3(),
  };

  function levelOnOrbit() {
    if (!focusedOrbitInto(orbit, stellata, focused)) return;
    setFrame(captureOrbitFrame(stellata.camera, orbit.normal, orbit.toCentre));
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
    setFrame(captureReferenceFrame(stellata.camera));
  });
  stage.setAttribute('role', 'img');
  stage.setAttribute('aria-label', 'Attitude indicator');
  stage.title = 'Click to level · double-click to level on the focused orbit '
    + '· right-click to set REF here';

  frameBtn.addEventListener('click', () => {
    const hasOrbit = focusedOrbitInto(orbit, stellata, focused);
    const next = nextFrameKey(
      frame.key,
      autoFrameFor(focusInputs(stellata, focused)),
      hasOrbit,
    );
    // Cycling into ORB captures the plane exactly as the gesture does, but
    // does not level on it: the flag chooses what the ball reads against,
    // and levelling is the gesture's own half of the job.
    setFrame(next === 'orbit'
      ? captureOrbitFrame(stellata.camera, orbit.normal, orbit.toCentre)
      : frames[next]);
  });

  invertBtn.addEventListener('click', () => stellata.invertView());

  // A manual pick holds only until the focus next changes — overriding sticks
  // while you study one object without freezing the automatic choice forever.
  stellata.on('focus', (target) => {
    focused = target;
    clicks.cancel();
    setFrame(frames[autoFrameFor(focusInputs(stellata, target))]);
  });

  stellata.on('frame', () => {
    const moved = !lastQuat.equals(stellata.camera.quaternion);
    if (host.hidden || document.body.hasAttribute('data-controls-hidden')) {
      missedWhileHidden = missedWhileHidden || moved;
      return;
    }
    if (!moved && !missedWhileHidden) return;
    missedWhileHidden = false;
    draw();
  });

  draw();
  return { level, levelOnOrbit };
}
