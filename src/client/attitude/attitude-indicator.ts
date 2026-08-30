// A gyro-sphere attitude indicator driven by the camera quaternion against a
// reference frame that follows the focused object, with click-to-level.

import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { BALL_DARK, BALL_LIGHT, createAttitudeBall } from './attitude-ball';
import {
  buildReferenceFrames,
  captureReferenceFrame,
  nextFrameKey,
  readAttitude,
  type Attitude,
  type ReferenceFrame,
  type ReferenceFrameKey,
} from './attitude-pure';
import type { Target } from '../camera/focus/focus-target';

const SVG_NS = 'http://www.w3.org/2000/svg';

const BALL_PX = 160;
const BOX = 192;
const C = BOX / 2;
// The sphere's silhouette in the mini-renderer: half-angle asin(1/6) against a
// half-FOV of 10°, scaled to the canvas. Every ring below is placed off it.
const BALL_R = (BALL_PX / 2) * (Math.tan(Math.asin(1 / 6)) / Math.tan((10 * Math.PI) / 180));

// Roll is unbounded out here, so the scale runs the whole way round rather
// than covering the shallow band an aircraft lives in.
const BANK_TICK_STEP_DEG = 5;
/** Which frame the focused object implies. Everything in Sol's system rides
 *  the ecliptic — that is the plane its planets actually orbit in — with Earth
 *  the single exception, where RA/Dec is the frame anyone reading the sky from
 *  the surface already thinks in. Beyond the system, galactic is the only frame
 *  still defined by something real. */
function autoFrameFor(stellata: Stellata, target: Target | null): ReferenceFrameKey {
  if (target === null) return 'galactic';
  if (target.kind === 'planet') {
    const name = stellata.kinds.planet?.displayName(target.idx);
    return name === 'Earth' ? 'equatorial' : 'ecliptic';
  }
  if (target.kind === 'probe') return 'ecliptic';
  if (target.kind === 'star' && target.idx === stellata.catalog.solIndex) {
    return 'ecliptic';
  }
  return 'galactic';
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
  if (deg % 90 === 0) return { len: 12, width: 3 };
  if (deg % 30 === 0) return { len: 8.5, width: 2.4 };
  if (deg % 10 === 0) return { len: 5.5, width: 1.8 };
  return { len: 3.5, width: 1.4 };
}

function buildBezel() {
  const g = el('g');
  const inner = BALL_R + 2.5;
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

export interface AttitudeIndicator {
  /** Zero the roll against the active frame. Bound to a click on the ball and
   *  to the `L` shortcut. */
  level(): void;
}

export function createAttitudeIndicator(stellata: Stellata): AttitudeIndicator | null {
  const host = document.getElementById('attitude');
  if (host === null) return null;
  host.hidden = false;
  host.innerHTML = '';
  host.style.width = `${BOX}px`;

  const frames = buildReferenceFrames();
  let frame: ReferenceFrame = frames.equatorial;
  let focused: Target | null = null;

  const ball = createAttitudeBall(BALL_PX);

  const stage = document.createElement('div');
  stage.className = 'attitude-stage';
  stage.style.width = `${BOX}px`;
  stage.style.height = `${BOX}px`;
  ball.canvas.className = 'ai-canvas';
  ball.canvas.style.left = `${(BOX - BALL_PX) / 2}px`;
  ball.canvas.style.top = `${(BOX - BALL_PX) / 2}px`;
  stage.appendChild(ball.canvas);

  const svg = el('svg', { class: 'ai-chrome', viewBox: `0 0 ${BOX} ${BOX}` });
  svg.appendChild(buildShading());
  svg.appendChild(buildBezel());
  const bankPointer = buildBankPointer();
  svg.appendChild(bankPointer);
  svg.appendChild(buildSymbol());
  stage.appendChild(svg);

  const frameBtn = document.createElement('button');
  frameBtn.type = 'button';
  frameBtn.className = 'attitude-frame';
  frameBtn.textContent = frame.label;
  frameBtn.title = 'Reference frame — click to cycle, right-click the ball to set REF';
  stage.appendChild(frameBtn);
  host.appendChild(stage);

  const attitude: Attitude = { pitchRad: 0, bankRad: 0, lonRad: 0, sinFromPole: 1 };
  const lastQuat = new THREE.Quaternion(2, 2, 2, 2);

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
    const ref = stellata.referenceUp;
    if (stellata.focus.getCameraMode() === 'observe') {
      ref.rollQuaternion(camera, ref.renderedRollError(camera, frame.pole));
    } else {
      ref.snapReferenceTo(camera, frame.pole);
    }
    draw();
  }

  stage.addEventListener('click', level);
  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    frames.reference = captureReferenceFrame(stellata.camera);
    setFrame(frames.reference);
  });
  stage.setAttribute('role', 'img');
  stage.setAttribute('aria-label', 'Attitude indicator');
  stage.title = 'Click to level · right-click to set REF here';

  frameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setFrame(frames[nextFrameKey(frame.key, autoFrameFor(stellata, focused))]);
  });

  // A manual pick holds only until the focus next changes — overriding sticks
  // while you study one object without freezing the automatic choice forever.
  stellata.on('focus', (target) => {
    focused = target;
    setFrame(frames[autoFrameFor(stellata, target)]);
  });

  stellata.on('frame', () => {
    if (lastQuat.equals(stellata.camera.quaternion)) return;
    draw();
  });

  draw();
  return { level };
}
