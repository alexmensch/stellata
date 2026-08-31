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
  captureReferenceFrame,
  captureTargetFrame,
  frameAvailableFor,
  nextFrameKey,
  emptyReferenceFrame,
  orbitFrameInto,
  copyReferenceFrame,
  orbitRideRotation,
  ridePoseBy,
  readAttitude,
  type Attitude,
  type AutoFrameKey,
  type ReferenceFrame,
} from './attitude-pure';
import { focusFrameInputs } from './focus-frame';
import { coordSphereNorthPole } from '../galactic/coord-spheres/coord-sphere-frames';
import { SPHERE_RADIUS_PC } from '../galactic/coord-spheres/coord-sphere';
import {
  focusedOrbitFrom,
  resolveFocusedOrbit,
  type FocusedOrbit,
  type FocusedOrbitSource,
} from './orbit-frame/orbit-plane';
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

/** The lock's padlock, drawn rather than typed: a text glyph would arrive as
 *  colour emoji on most platforms and at a size the font decides. Sized in
 *  `em` so it tracks the chip's own text, and stroked in `currentColor` so it
 *  inverts with the chip when the lock is engaged. */
function lockGlyph(): SVGSVGElement {
  const svg = el('svg', { class: 'ai-lock-glyph', viewBox: '0 0 10 12' });
  svg.appendChild(el('path', {
    d: 'M3 5 V3.4 a2 2 0 0 1 4 0 V5',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.3,
  }));
  svg.appendChild(el('rect', {
    x: 1.4, y: 5, width: 7.2, height: 6, rx: 1, fill: 'currentColor',
  }));
  return svg;
}

export interface AttitudeIndicator {
  /** Zero the roll against the active frame. Bound to a click on the ball and
   *  to the `L` shortcut. */
  level(): void;
  /** Step the reference frame on. The corner flag's click, and `S` in
   *  navigate — where the ball is what a frame change moves. */
  cycleFrame(): void;
  /** Aim the camera at the showing frame's origin — 0° longitude, 0°
   *  latitude — or at its antipode. `Z` and `Shift`+`Z`. */
  aimAtFrameOrigin(opposite: boolean): void;
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
  // REF and TGT are captured from a gesture rather than chosen off the table,
  // so the instrument holds them; every other frame is `filter.coordSphere`,
  // which `S` and the panel write too. The ball can never read against
  // nothing, so an unselected grid resolves to the focus default.
  let captured: ReferenceFrame | null = null;
  // ORB is neither: it is rebuilt from the live orbit every tick, so what the
  // flag holds is the choice, not a frame — § Orbit rate.
  let orbitActive = false;
  // Ride the orbit: hold the attitude the ball is showing as the frame turns
  // beneath it, so the camera swings round with the object. ORB only — it is
  // the one frame whose datum moves, and there is nothing to ride otherwise.
  let orbitLocked = false;
  const orbitFrame = emptyReferenceFrame();
  // ORB as it stood when the lock last rode it — the whole basis, not just the
  // datum: the plane precesses under a moon and the ride has to carry that
  // too. § The lock.
  const riddenFrame = emptyReferenceFrame();
  const rideRotation = new THREE.Quaternion();
  let riding = false;
  const orbit: FocusedOrbit = {
    normal: new THREE.Vector3(),
    toCentre: new THREE.Vector3(),
  };
  let orbitSource: FocusedOrbitSource | null = null;

  /** Which orbit the focus rides, resolved once and held: for a pair that
   *  settles the plane normal, which is a static function of frozen elements
   *  and has no business being re-derived per frame. Re-asked while null
   *  because the binaries artifact and the planet kind both attach after a
   *  focus can be set. */
  function orbitSourceNow(): FocusedOrbitSource | null {
    orbitSource ??= resolveFocusedOrbit(stellata, focused);
    return orbitSource;
  }

  /** Re-read the orbit and rewrite `orbitFrame` in place. False when nothing
   *  focused rides an orbit the model has elements for, which is also how the
   *  frame stops being offered the moment that stops being true. */
  function refreshOrbitFrame(): boolean {
    const source = orbitSourceNow();
    if (source === null || !focusedOrbitFrom(orbit, source, stellata)) return false;
    orbitFrameInto(orbitFrame, stellata.camera, orbit.normal, orbit.toCentre);
    return true;
  }

  function selectedFrameKey(): AutoFrameKey {
    const selected = stellata.filters.getFilter().coordSphere;
    return selected === 'none'
      ? autoFrameFor(focusFrameInputs(stellata, focused))
      : selected;
  }

  function resolveFrame(): ReferenceFrame {
    if (captured !== null) return captured;
    if (orbitActive && refreshOrbitFrame()) return orbitFrame;
    return frames[selectedFrameKey()];
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
  const lockBtn = cornerChip(
    'attitude-lock',
    '',
    'Lock the camera to the orbit — hold this attitude as the object travels',
  );
  lockBtn.appendChild(lockGlyph());
  lockBtn.setAttribute('aria-label', 'Lock the camera to the orbit');
  // The flag and the lock read as one control, so they share a border rather
  // than sitting apart: a column pinned to the corner, the lock hanging off
  // the flag's bottom edge and only while ORB is the frame it could lock to.
  const flagStack = document.createElement('div');
  flagStack.className = 'attitude-flag-stack';
  flagStack.appendChild(frameBtn);
  flagStack.appendChild(lockBtn);
  host.appendChild(stage);
  // Outside the stage, which is clipped to its disc so the square's corners
  // stay clicks on the sky. The chips sit in three of those corners.
  host.appendChild(refBtn);
  host.appendChild(flagStack);
  host.appendChild(invertBtn);

  const attitude: Attitude = { pitchRad: 0, bankRad: 0, lonRad: 0, sinFromPole: 1 };
  const lastQuat = new THREE.Quaternion(2, 2, 2, 2);
  // The datum the last draw was against. NaN-seeded so the first draw always
  // lands, and the pair with `lastQuat` is what makes "the reading moved" the
  // redraw test rather than "a live frame is up".
  const drawnZeroLon = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  let bankTransform = '';
  // Set while the instrument is off screen so the ball catches up on the
  // first frame after it comes back, rather than showing a stale attitude.
  let missedWhileHidden = false;

  /** Carry the camera by exactly the rotation ORB underwent since the lock
   *  last rode it, so its attitude against ORB is unchanged and the ball reads
   *  the same. True when it wrote.
   *
   *  **This is a camera writer on the steady-state navigate path**, which
   *  `../camera/controls/input/README.md` § Orbit drift otherwise forbids. It
   *  is admissible for the reason a gesture is: it writes only on a frame
   *  where the datum moved far enough for the write to show, so the render
   *  gate can still idle between rides. */
  function rideOrbit(): boolean {
    const moved = orbitRideRotation(
      rideRotation, riddenFrame, orbitFrame, stellata.visibleCameraTurnRad(),
    );
    if (!moved) return false;
    const camera = stellata.camera;
    const pivot = stellata.controls.target;
    ridePoseBy(camera.position, camera.up, pivot, rideRotation);
    // `ridePoseBy` writes the pose — position and up. Every reader
    // downstream takes the QUATERNION, which is derived from those by
    // `lookAt`, and TrackballControls does not run again until the next tick
    // (`../camera/controls/input/README.md` § Roll authority, derivation A).
    // Without this the frame draws the new position through the old aim, and
    // the ball reads the new datum against the old attitude — a lag of
    // exactly one frame's turn, which is a degree at 9 hr/s and half a
    // revolution once the datum turns 180° between frames.
    camera.lookAt(pivot);
    return true;
  }

  /** Re-read ORB and, while the lock is engaged, carry the camera by however
   *  far the datum turned.
   *
   *  **Deliberately not part of `draw`.** The lock moves the CAMERA, not the
   *  instrument, so it has to keep running on frames the instrument is hidden
   *  for — `U`, a collapsed panel, an off-screen check of any kind. Gating it
   *  on the drawing path made hiding the UI silently disengage the lock and
   *  then replay the whole accumulated turn as one swing when it came back. */
  function tickOrbitFrame(): void {
    if (captured !== null || !orbitActive) return;
    if (!refreshOrbitFrame()) {
      orbitActive = false;
      riding = false;
      return;
    }
    frame = orbitFrame;
    const rideable = orbitLocked
      && stellata.focus.getCameraMode() === 'navigate'
      && !stellata.isCameraTransitionActive();
    // `riding` false is a seeding frame — the lock has just been engaged, or a
    // transition has just released the camera — and adopts the datum without
    // riding it, so neither replays as one enormous swing.
    const carry = rideable && riding;
    const rode = carry && rideOrbit();
    // A turn too small to see is not ridden and NOT forgotten: leaving the
    // datum where it was last ridden from is what accumulates those turns into
    // one that is worth a frame, instead of dropping each one.
    if (!carry || rode) copyReferenceFrame(riddenFrame, orbitFrame);
    riding = rideable;
  }

  function draw() {
    const camera = stellata.camera;
    lastQuat.copy(camera.quaternion);
    drawnZeroLon.copy(frame.zeroLon);
    ball.render(camera, frame);
    readAttitude(camera, frame, attitude);
    const bankDeg = (attitude.bankRad * 180) / Math.PI;
    const transform = `rotate(${bankDeg.toFixed(2)} ${C} ${C})`;
    // Two hundredths of a degree of bank is the caret's own resolution, so
    // below that there is nothing to write — and an attribute write on an SVG
    // element invalidates style whether or not the value changed.
    if (transform !== bankTransform) {
      bankTransform = transform;
      bankPointer.setAttribute('transform', transform);
    }
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
    const flagLabel = orbitActive ? 'ORB' : frames[selectedFrameKey()].label;
    // The lock has nothing to ride unless ORB is what the ball is reading, so
    // it leaves with the frame — and with a REF or TGT datum held over the
    // top — rather than lingering as a control that does nothing.
    const orbitShowing = orbitActive && stop === 'off';
    if (!orbitShowing) {
      orbitLocked = false;
      riding = false;
    }
    lockBtn.hidden = !orbitShowing;
    lockBtn.classList.toggle('on', orbitLocked);
    lockBtn.setAttribute('aria-pressed', orbitLocked ? 'true' : 'false');
    refBtn.textContent = stop === 'target' ? 'TGT' : 'REF';
    refBtn.classList.toggle('on', stop !== 'off');
    refBtn.setAttribute('aria-pressed', stop !== 'off' ? 'true' : 'false');
    frameBtn.textContent = flagLabel;
    const next = resolveFrame();
    if (next === frame) return;
    frame = next;
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

  function levelOnOrbit() {
    // ORB is the instrument's frame, and the instrument is navigate-only.
    if (stellata.focus.getCameraMode() === 'observe') return;
    if (!refreshOrbitFrame()) return;
    captured = null;
    orbitActive = true;
    refresh();
    level();
  }

  const aimPoint = new THREE.Vector3();

  /** Aim at where the showing frame reads 0/0 — or, opposite, at where it
   *  reads 180/0. The point is put on the coordinate sphere's own radius, so
   *  in observe it is literally the grid intersection you are looking at.
   *
   *  Observe reads the drawn grid rather than the instrument, which is not on
   *  screen there: with no grid up there is no origin to aim at, and a datum
   *  armed back in navigate is not what the user can see. */
  function aimAtFrameOrigin(opposite: boolean): void {
    let origin = frame.zeroLon;
    if (stellata.focus.getCameraMode() === 'observe') {
      const selected = stellata.filters.getFilter().coordSphere;
      if (selected === 'none') return;
      origin = frames[selected].zeroLon;
    }
    aimPoint.copy(origin)
      .multiplyScalar(opposite ? -SPHERE_RADIUS_PC : SPHERE_RADIUS_PC)
      .add(stellata.camera.position);
    stellata.aimAt(aimPoint);
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
    const source = orbitSourceNow();
    const hasOrbit = source !== null && focusedOrbitFrom(orbit, source, stellata);
    const inputs = focusFrameInputs(stellata, focused);
    const next = nextFrameKey(
      frame.key,
      autoFrameFor(inputs),
      hasOrbit,
      (candidate) => frameAvailableFor(candidate, inputs),
    );
    // Cycling into ORB arms the same live frame the gesture does, but does
    // not level on it: the flag chooses what the ball reads against, and
    // levelling is the gesture's own half of the job.
    captured = null;
    orbitActive = false;
    if (next === 'orbit') {
      orbitActive = true;
    } else {
      stellata.filters.setFilter({ coordSphere: next });
    }
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

  lockBtn.addEventListener('click', () => {
    orbitLocked = !orbitLocked;
    // Seed the ride from wherever the datum is now, so engaging the lock
    // never replays the travel since ORB was armed as one jump.
    riding = false;
    refresh();
    draw();
  });

  invertBtn.addEventListener('click', () => stellata.invertView());

  // A captured datum belongs to the object it was taken on: ORB reads a plane
  // that object rides and REF an attitude held while looking at it, so neither
  // survives the focus moving. The table frames do — the shell demotes the
  // selection only when the new focus takes its meaning away.
  stellata.on('focus', (target) => {
    focused = target;
    orbitSource = null;
    clicks.cancel();
    captured = null;
    orbitActive = false;
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
      orbitActive = false;
    }
    refresh();
  });

  // The instrument is navigate-only: observe has the drawn grid instead, and
  // two answers to "which way is north" on screen at once is what let the
  // roll guide and this disagree. The whole panel goes, not just the ball —
  // an Instruments box holding nothing reads as a fault.
  const applyModeVisibility = () => {
    const observing = stellata.focus.getCameraMode() === 'observe';
    // The ride orbits the camera about `controls.target`, which is not what
    // observe's camera does — it sits on the object rather than circling it.
    if (observing) {
      orbitLocked = false;
      riding = false;
    }
    if (panel !== null) panel.hidden = observing;
  };
  stellata.on('cameraMode', applyModeVisibility);
  applyModeVisibility();

  // Not 'frame': that fires after the render, so the ride would land on a
  // frame already drawn and the ball would read this frame's datum against
  // last frame's attitude. 'preRender' is after the fan-out — so the datum is
  // current — and before anything reads the camera.
  stellata.on('preRender', tickOrbitFrame);

  stellata.on('frame', () => {
    // A live ORB datum turns with the orbit, so a still camera is not a still
    // instrument — but the test is that the DATUM moved, not that a live frame
    // is up: with the clock paused ORB rebuilds to the same vector and there
    // is nothing to redraw. Nothing runs while the render gate idles either —
    // if no frame is drawn, the orbit has not advanced.
    const moved = (orbitActive && captured === null
      && !drawnZeroLon.equals(orbitFrame.zeroLon))
      || !lastQuat.equals(stellata.camera.quaternion);
    if (offScreen()) {
      missedWhileHidden = missedWhileHidden || moved;
      return;
    }
    if (!moved && !missedWhileHidden) return;
    missedWhileHidden = false;
    draw();
  });

  draw();
  return { level, cycleFrame, aimAtFrameOrigin };
}
