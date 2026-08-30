// Throwaway spike: an aircraft-style attitude indicator driven by the camera
// quaternion against a selectable reference frame, with click-to-level.

import type { Stellata } from '../stellata';
import {
  buildReferenceFrames,
  formatLatitude,
  readAttitude,
  type Attitude,
  type ReferenceFrame,
  type ReferenceFrameKey,
} from './attitude-pure';

const SVG_NS = 'http://www.w3.org/2000/svg';

const CX = 66;
const CY = 60;
const R = 50;
const PX_PER_DEG = 0.8;
const LADDER_STEP_DEG = 10;
const LADDER_MAX_DEG = 80;
const MAJOR_EVERY_DEG = 30;
const BANK_TICKS_DEG = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
const POLE_WARN_SIN = Math.sin((15 * Math.PI) / 180);

const FRAME_CYCLE: ReferenceFrameKey[] = ['equatorial', 'ecliptic', 'galactic'];

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function buildBall(clipId: string) {
  const ball = el('g', {});
  ball.appendChild(el('rect', { x: CX - 200, y: CY - 400, width: 400, height: 400, class: 'ai-north' }));
  ball.appendChild(el('rect', { x: CX - 200, y: CY, width: 400, height: 400, class: 'ai-south' }));

  for (let d = -LADDER_MAX_DEG; d <= LADDER_MAX_DEG; d += LADDER_STEP_DEG) {
    if (d === 0) continue;
    const major = d % MAJOR_EVERY_DEG === 0;
    const half = major ? 16 : 8;
    const y = CY - d * PX_PER_DEG;
    ball.appendChild(
      el('line', { x1: CX - half, y1: y, x2: CX + half, y2: y, class: 'ai-rung' }),
    );
    if (major) {
      for (const side of [-1, 1]) {
        const t = el('text', {
          x: CX + side * (half + 4),
          y: y + 3,
          class: 'ai-rung-label',
          'text-anchor': side < 0 ? 'end' : 'start',
        });
        t.textContent = String(Math.abs(d));
        ball.appendChild(t);
      }
    }
  }
  ball.appendChild(
    el('line', { x1: CX - 200, y1: CY, x2: CX + 200, y2: CY, class: 'ai-horizon' }),
  );

  const clipped = el('g', { 'clip-path': `url(#${clipId})` });
  clipped.appendChild(ball);
  return { clipped, ball };
}

function buildBezel() {
  const g = el('g', {});
  for (const d of BANK_TICKS_DEG) {
    const rad = ((d - 90) * Math.PI) / 180;
    const outer = R;
    const inner = R - (d % 30 === 0 ? 7 : 4);
    g.appendChild(
      el('line', {
        x1: CX + Math.cos(rad) * inner,
        y1: CY + Math.sin(rad) * inner,
        x2: CX + Math.cos(rad) * outer,
        y2: CY + Math.sin(rad) * outer,
        class: 'ai-bank-tick',
      }),
    );
  }
  g.appendChild(el('circle', { cx: CX, cy: CY, r: R, class: 'ai-bezel' }));
  return g;
}

function buildAircraftSymbol() {
  const g = el('g', { class: 'ai-symbol' });
  g.appendChild(el('line', { x1: CX - 24, y1: CY, x2: CX - 8, y2: CY }));
  g.appendChild(el('line', { x1: CX + 8, y1: CY, x2: CX + 24, y2: CY }));
  g.appendChild(el('circle', { cx: CX, cy: CY, r: 1.6 }));
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

  const clipId = 'ai-clip';
  const svg = el('svg', { class: 'ai-svg', viewBox: '0 0 132 118', width: 132, height: 118 });
  const defs = el('defs', {});
  const clip = el('clipPath', { id: clipId });
  clip.appendChild(el('circle', { cx: CX, cy: CY, r: R - 1 }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  const { clipped, ball } = buildBall(clipId);
  svg.appendChild(clipped);
  svg.appendChild(buildBezel());

  const bankPointer = el('polygon', {
    points: `${CX},${CY - R + 2} ${CX - 5},${CY - R + 11} ${CX + 5},${CY - R + 11}`,
    class: 'ai-bank-pointer',
  });
  svg.appendChild(bankPointer);
  svg.appendChild(buildAircraftSymbol());

  const lonText = el('text', { x: CX, y: 112, class: 'ai-readout', 'text-anchor': 'middle' });
  svg.appendChild(lonText);
  host.appendChild(svg);

  const bar = document.createElement('div');
  bar.className = 'attitude-bar';
  const frameBtn = document.createElement('button');
  frameBtn.type = 'button';
  frameBtn.className = 'attitude-frame';
  const bankLabel = document.createElement('span');
  bankLabel.className = 'attitude-bank';
  bar.append(frameBtn, bankLabel);
  host.appendChild(bar);

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

  svg.addEventListener('click', levelNow);
  svg.setAttribute('role', 'button');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', 'Level the camera against the reference frame');

  frameBtn.addEventListener('click', () => {
    frameKey = FRAME_CYCLE[(FRAME_CYCLE.indexOf(frameKey) + 1) % FRAME_CYCLE.length];
    frame = frames[frameKey];
    frameBtn.textContent = frame.label;
  });
  frameBtn.textContent = frame.label;

  let lastLon = '';
  let lastBank = '';

  stellata.on('frame', () => {
    readAttitude(stellata.camera, frame, attitude);

    const bankDeg = (attitude.bankRad * 180) / Math.PI;
    const pitchDeg = (attitude.pitchRad * 180) / Math.PI;
    ball.setAttribute(
      'transform',
      `rotate(${bankDeg.toFixed(2)} ${CX} ${CY}) translate(0 ${(pitchDeg * PX_PER_DEG).toFixed(2)})`,
    );
    bankPointer.setAttribute('transform', `rotate(${bankDeg.toFixed(2)} ${CX} ${CY})`);

    const lon = `${frame.lonSymbol} ${frame.formatLon(attitude.lonRad)}   ${frame.latSymbol} ${formatLatitude(attitude.pitchRad)}`;
    if (lon !== lastLon) {
      lonText.textContent = lon;
      lastLon = lon;
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
