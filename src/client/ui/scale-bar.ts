import type { Stellata } from '../stellata';
import { AU_PER_PC } from '../util/astronomy-constants';
import {
  fmtDistAuto,
  niceRound,
  getUnit,
  LY_PER_PC,
  AU_SWITCH_PC,
} from './distance-util';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Horizontal scene-scale bar targets ~20% of viewport width before
// snap-to-nice trims it to a 1/2/5×10^N value. niceRound brings it back
// down to between 0.27× and 1.5× the target — wide enough to read clearly
// on a desktop, slim enough to leave room for the meta widget.
const TARGET_BAR_FRAC = 0.20;

// Three internal ticks at 25/50/75% — quartering reads naturally for
// niceRound values like 100, 1000, 10 (round multiples of 4 fractions).
// The tradeoff for 1/2/5 nice values is minor; we accept a small
// inconsistency on "5 pc" rather than carry a per-decade tick policy.
const TICK_FRACTIONS = [0.25, 0.5, 0.75];
const TICK_HEIGHT_PX = 4;
const ENDCAP_HEIGHT_PX = 7;

const PAD_LEFT_PX = 10;
const PAD_TOP_PX = 4;
const BAR_LABEL_GAP_PX = 6;
const BAR_LABEL_HEIGHT_PX = 14;

interface Elements {
  svg: SVGSVGElement;
  hLine: SVGLineElement;
  hEndcapL: SVGLineElement;
  hEndcapR: SVGLineElement;
  hTicks: SVGLineElement[];
  hLabel: SVGTextElement;
}

export function createScaleBar(stellata: Stellata) {
  const host = document.getElementById('scale-bar')!;
  host.hidden = false;
  host.innerHTML = '';

  const els = buildSvg();
  host.appendChild(els.svg);

  let lastSig = '';

  stellata.on('frame', () => {
    const camera = stellata.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;

    let barPx: number;
    let label: string;
    if (stellata.getCameraMode() === 'observe') {
      // OBSERVE: angular extent of sky — "scene scale at camera-target
      // depth" is meaningless when the camera sits on the focal star.
      const targetBarPx = w * TARGET_BAR_FRAC;
      const pxPerDeg = h / camera.fov;
      const idealDeg = targetBarPx / pxPerDeg;
      const niceDeg = niceRound(idealDeg);
      barPx = niceDeg * pxPerDeg;
      label = formatDegrees(niceDeg);
    } else {
      const target = stellata.controls.target;
      const focalDepth = Math.max(camera.position.distanceTo(target), 1e-12);
      const fovRad = (camera.fov * Math.PI) / 180;
      const pxPerPc = h / (2 * focalDepth * Math.tan(fovRad / 2));

      const targetBarPx = w * TARGET_BAR_FRAC;
      const idealPc = targetBarPx / pxPerPc;
      let nicePc: number;
      if (idealPc < AU_SWITCH_PC) {
        // AU regime — niceRound on the AU value so the bar lands on a
        // round Voyager-class number ("1000 AU" not "0.005 pc").
        const niceAu = niceRound(idealPc * AU_PER_PC);
        nicePc = niceAu / AU_PER_PC;
      } else {
        const isLy = getUnit() === 'ly';
        const display = niceRound(isLy ? idealPc * LY_PER_PC : idealPc);
        nicePc = isLy ? display / LY_PER_PC : display;
      }
      barPx = nicePc * pxPerPc;
      label = fmtDistAuto(nicePc);
    }

    const sig = `${barPx.toFixed(1)}|${label}`;
    if (sig === lastSig) return;
    lastSig = sig;
    drawHorizontalBar(els, barPx, label);
    sizeSvg(els, barPx);
  });
}

function buildSvg(): Elements {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('class', 'scale-bar-svg');
  svg.setAttribute('xmlns', SVG_NS);

  const hLine = mkLine('h-line');
  const hEndcapL = mkLine('h-endcap');
  const hEndcapR = mkLine('h-endcap');
  const hTicks = TICK_FRACTIONS.map(() => mkLine('h-tick'));
  const hLabel = mkText('h-label', 'middle', 'hanging');

  svg.append(hLine, hEndcapL, hEndcapR, ...hTicks, hLabel);

  return { svg, hLine, hEndcapL, hEndcapR, hTicks, hLabel };
}

function mkLine(cls: string): SVGLineElement {
  const el = document.createElementNS(SVG_NS, 'line') as SVGLineElement;
  el.setAttribute('class', cls);
  return el;
}

function mkText(
  cls: string,
  anchor: 'start' | 'middle' | 'end',
  baseline: 'auto' | 'hanging' | 'middle' | 'central',
): SVGTextElement {
  const el = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
  el.setAttribute('class', cls);
  el.setAttribute('text-anchor', anchor);
  el.setAttribute('dominant-baseline', baseline);
  return el;
}

function sizeSvg(els: Elements, barPx: number): void {
  const totalH = PAD_TOP_PX + ENDCAP_HEIGHT_PX + BAR_LABEL_GAP_PX + BAR_LABEL_HEIGHT_PX;
  // The right edge needs to clear the bar's right endcap plus the right
  // half of the bar label (centred on the right endcap, not the midpoint).
  const barLabelHalfWidth = 30; // covers labels up to ~60px wide ("1234 AU", "12.5 pc")
  const totalW = PAD_LEFT_PX + barPx + barLabelHalfWidth + 8;

  els.svg.setAttribute('width', String(Math.ceil(totalW)));
  els.svg.setAttribute('height', String(Math.ceil(totalH)));
}

function drawHorizontalBar(els: Elements, barPx: number, label: string): void {
  const baselineY = PAD_TOP_PX;
  const x0 = PAD_LEFT_PX;
  const x1 = PAD_LEFT_PX + barPx;

  setLine(els.hLine, x0, baselineY, x1, baselineY);
  setLine(els.hEndcapL, x0, baselineY, x0, baselineY + ENDCAP_HEIGHT_PX);
  setLine(els.hEndcapR, x1, baselineY, x1, baselineY + ENDCAP_HEIGHT_PX);
  for (let i = 0; i < TICK_FRACTIONS.length; i++) {
    const tx = x0 + barPx * TICK_FRACTIONS[i];
    setLine(els.hTicks[i], tx, baselineY, tx, baselineY + TICK_HEIGHT_PX);
  }
  // Anchor the label at the bar's right end (centered on the right
  // endcap) rather than at the bar's midpoint. The internal ticks make
  // a midpoint-centered label read as "this distance is to the nearest
  // tick" — anchoring it at the terminating endcap clarifies that the
  // value applies to the whole bar.
  els.hLabel.setAttribute('x', String(x1));
  els.hLabel.setAttribute('y', String(baselineY + ENDCAP_HEIGHT_PX + BAR_LABEL_GAP_PX));
  els.hLabel.textContent = label;
}

function setLine(el: SVGLineElement, x1: number, y1: number, x2: number, y2: number): void {
  el.setAttribute('x1', x1.toFixed(2));
  el.setAttribute('y1', y1.toFixed(2));
  el.setAttribute('x2', x2.toFixed(2));
  el.setAttribute('y2', y2.toFixed(2));
}

function formatDegrees(deg: number): string {
  if (deg >= 1) return `${deg.toFixed(0)}°`;
  if (deg >= 0.1) return `${deg.toFixed(1)}°`;
  return `${deg.toFixed(2)}°`;
}
