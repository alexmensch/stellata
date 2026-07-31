// The display-calibration surface: a full-bleed, non-photometric screen of
// authored sRGB patches, opened from the Camera panel or the K shortcut.
// See src/client/calibration/README.md.

import { bindModalDismissal, type ModalHandle } from '../modals/modal-dismiss';
import {
  BLACK_POINT_CODES,
  HIGHLIGHT_CODES,
  gammaCells,
  greyCss,
  greyWedgeCodes,
} from './calibration-ladders-pure';
import { drawGammaCell } from './gamma-pattern';

export function bindCalibrationOverlay(): ModalHandle {
  const modal = document.getElementById('calibration-modal')!;

  // The wedge spans exactly the black-point ladder, so the two sections
  // share an extent at any swatch size. Published rather than hardcoded in
  // the stylesheet so the ladder stays the single source of its own length.
  modal.querySelector<HTMLElement>('.calib-surface')?.style.setProperty(
    '--calib-columns',
    String(BLACK_POINT_CODES.length),
  );

  renderSwatchLadder(modal.querySelector('#calib-blackpoint'), BLACK_POINT_CODES, true);
  renderSwatchLadder(modal.querySelector('#calib-highlight-patches'), HIGHLIGHT_CODES, false);
  renderWedge(modal.querySelector('#calib-wedge'));

  const gammaRow = modal.querySelector<HTMLElement>('#calib-gamma');
  const redrawGamma = renderGammaRow(gammaRow);
  window.addEventListener('resize', redrawGamma);

  const reveal = modal.querySelector<HTMLButtonElement>('#calib-highlight-reveal');
  const highlight = modal.querySelector<HTMLElement>('#calib-highlight');
  reveal?.addEventListener('click', () => {
    const shown = highlight?.classList.toggle('is-revealed') ?? false;
    reveal.textContent = shown ? 'hide' : 'reveal — bright';
    reveal.setAttribute('aria-expanded', shown ? 'true' : 'false');
  });

  const handle = bindModalDismissal(modal, {
    beforeClose: () => {
      // A revealed white field is the wrong state to reopen into: the next
      // open starts with the black point, which needs a dark screen.
      highlight?.classList.remove('is-revealed');
      if (reveal) {
        reveal.textContent = 'reveal — bright';
        reveal.setAttribute('aria-expanded', 'false');
      }
    },
  });

  // Cut the cells after the reveal, never before: they size themselves from
  // their laid-out box, which is zero while the overlay is still hidden.
  const open = () => {
    handle.open();
    redrawGamma();
  };

  document.getElementById('calibrate-open')?.addEventListener('click', open);

  return { open, close: handle.close };
}

function renderSwatchLadder(
  host: Element | null,
  codes: readonly number[],
  numbered: boolean,
): void {
  if (!host) return;
  const frag = document.createDocumentFragment();
  codes.forEach((code, i) => {
    const cell = document.createElement('div');
    cell.className = 'calib-cell';
    const swatch = document.createElement('div');
    swatch.className = 'calib-swatch';
    swatch.style.background = greyCss(code);
    const label = document.createElement('span');
    label.className = 'calib-cell-label';
    label.textContent = numbered ? String(i + 1) : String(code);
    cell.append(swatch, label);
    frag.append(cell);
  });
  host.replaceChildren(frag);
}

function renderWedge(host: Element | null): void {
  if (!host) return;
  const frag = document.createDocumentFragment();
  for (const code of greyWedgeCodes()) {
    const step = document.createElement('div');
    step.className = 'calib-wedge-step';
    step.style.background = greyCss(code);
    frag.append(step);
  }
  host.replaceChildren(frag);
}

/** Returns a redraw callback — the cells are device-pixel exact, so they
 *  have to be re-cut whenever `devicePixelRatio` changes (window moved to
 *  another display). */
function renderGammaRow(host: HTMLElement | null): () => void {
  if (!host) return () => {};
  const canvases: { canvas: HTMLCanvasElement; code: number }[] = [];
  const frag = document.createDocumentFragment();
  for (const stop of gammaCells()) {
    const cell = document.createElement('div');
    cell.className = 'calib-cell';
    const canvas = document.createElement('canvas');
    canvas.className = 'calib-gamma-cell';
    const label = document.createElement('span');
    label.className = 'calib-cell-label';
    label.textContent = stop.label;
    if (stop.isReference) cell.classList.add('is-target');
    cell.append(canvas, label);
    canvases.push({ canvas, code: stop.code });
    frag.append(cell);
  }
  host.replaceChildren(frag);

  return () => {
    const dpr = window.devicePixelRatio || 1;
    for (const { canvas, code } of canvases) drawGammaCell(canvas, code, dpr);
  };
}
