// Throwaway spike: a gyro-sphere attitude indicator driven by the camera
// quaternion against a selectable reference frame, with click-to-level.

import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { createAttitudeBall } from './attitude-ball';
import {
  buildReferenceFrames,
  formatLatitude,
  readAttitude,
  type Attitude,
  type ReferenceFrame,
  type ReferenceFrameKey,
} from './attitude-pure';

const SVG_NS = 'http://www.w3.org/2000/svg';

const BALL_PX = 128;
const BOX = 144;
const C = BOX / 2;
// The sphere's silhouette in the mini-renderer: half-angle asin(1/6) against a
// half-FOV of 10°, scaled to the canvas. Every ring below is placed off it.
const BALL_R = (BALL_PX / 2) * (Math.tan(Math.asin(1 / 6)) / Math.tan((10 * Math.PI) / 180));

const BANK_TICKS_DEG = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
const POLE_WARN_SIN = Math.sin((15 * Math.PI) / 180);
const FRAME_CYCLE: ReferenceFrameKey[] = ['equatorial', 'ecliptic', 'galactic'];

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

function buildBezel() {
  const g = el('g');
  for (const d of BANK_TICKS_DEG) {
    const rad = ((d - 90) * Math.PI) / 180;
    const inner = BALL_R + 2;
    const outer = inner + (d % 30 === 0 ? 6 : 3.5);
    g.appendChild(
      el('line', {
        x1: C + Math.cos(rad) * inner,
        y1: C + Math.sin(rad) * inner,
        x2: C + Math.cos(rad) * outer,
        y2: C + Math.sin(rad) * outer,
        class: 'ai-bank-tick',
      }),
    );
  }
  g.appendChild(el('circle', { cx: C, cy: C, r: BALL_R + 1, class: 'ai-bezel' }));
  return g;
}

function buildSymbol() {
  const g = el('g', { class: 'ai-symbol' });
  g.appendChild(el('line', { x1: C - 30, y1: C, x2: C - 10, y2: C }));
  g.appendChild(el('line', { x1: C + 10, y1: C, x2: C + 30, y2: C }));
  g.appendChild(el('circle', { cx: C, cy: C, r: 2 }));
  return g;
}

export function createAttitudeIndicator(stellata: Stellata) {
  const host = document.getElementById('attitude');
  if (!host) return;
  host.hidden = false;
  host.innerHTML = '';

  const frames = buildReferenceFrames();
  let frameKey: ReferenceFrameKey = 'equatorial';
  let frame: ReferenceFrame = frames[frameKey];

  const ball = createAttitudeBall(BALL_PX);
  ball.setFrame(frame);

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
  const bankPointer = el('polygon', {
    points: `${C},${C - BALL_R + 1} ${C - 5.5},${C - BALL_R + 11} ${C + 5.5},${C - BALL_R + 11}`,
    class: 'ai-bank-pointer',
  });
  svg.appendChild(bankPointer);
  svg.appendChild(buildSymbol());
  stage.appendChild(svg);
  host.appendChild(stage);

  const bar = document.createElement('div');
  bar.className = 'attitude-bar';
  const frameBtn = document.createElement('button');
  frameBtn.type = 'button';
  frameBtn.className = 'attitude-frame';
  frameBtn.textContent = frame.label;
  const coords = document.createElement('span');
  coords.className = 'attitude-coords';
  const bankLabel = document.createElement('span');
  bankLabel.className = 'attitude-bank';
  bar.append(frameBtn, coords);
  host.append(bar, bankLabel);

  const attitude: Attitude = { pitchRad: 0, bankRad: 0, lonRad: 0, sinFromPole: 1 };

  function levelNow() {
    if (stellata.isCameraTransitionActive()) return;
    const camera = stellata.camera;
    const ref = stellata.referenceUp;
    if (stellata.focus.getCameraMode() === 'observe') {
      ref.rollQuaternion(camera, ref.renderedRollError(camera, frame.pole));
    } else {
      ref.snapReferenceTo(camera, frame.pole);
    }
  }

  stage.addEventListener('click', levelNow);
  stage.setAttribute('role', 'button');
  stage.setAttribute('tabindex', '0');
  stage.setAttribute('aria-label', 'Level the camera against the reference frame');
  stage.title = 'Click to level';

  frameBtn.addEventListener('click', () => {
    frameKey = FRAME_CYCLE[(FRAME_CYCLE.indexOf(frameKey) + 1) % FRAME_CYCLE.length];
    frame = frames[frameKey];
    frameBtn.textContent = frame.label;
    ball.setFrame(frame);
    lastQuat.set(2, 2, 2, 2);
  });

  const lastQuat = new THREE.Quaternion(2, 2, 2, 2);
  let lastCoords = '';
  let lastBank = '';

  stellata.on('frame', () => {
    const camera = stellata.camera;
    if (lastQuat.equals(camera.quaternion)) return;
    lastQuat.copy(camera.quaternion);

    ball.render(camera, frame);
    readAttitude(camera, frame, attitude);

    const bankDeg = (attitude.bankRad * 180) / Math.PI;
    bankPointer.setAttribute('transform', `rotate(${bankDeg.toFixed(2)} ${C} ${C})`);

    const text = `${frame.lonSymbol} ${frame.formatLon(attitude.lonRad)}  ${frame.latSymbol} ${formatLatitude(attitude.pitchRad)}`;
    if (text !== lastCoords) {
      coords.textContent = text;
      lastCoords = text;
    }

    const nearPole = attitude.sinFromPole < POLE_WARN_SIN;
    const shown = -bankDeg;
    const bank = nearPole
      ? 'over the pole'
      : `bank ${Math.abs(shown).toFixed(0)}° ${shown >= 0 ? 'R' : 'L'}`;
    if (bank !== lastBank) {
      bankLabel.textContent = bank;
      bankLabel.classList.toggle('is-warn', nearPole);
      lastBank = bank;
    }
  });
}
