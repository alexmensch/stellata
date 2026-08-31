import type { Stellata } from '../../stellata';
import {
  ALL_SPECT_MASK,
  DEFAULT_FOV,
  STAR_K_MULTIPLIER_MAX,
  STAR_K_MULTIPLIER_MIN,
  STAR_K_MULTIPLIER_STEP,
} from '../../filters/filter-state';
import { COORD_SPHERE_FRAMES } from '../../galactic/coord-spheres/coord-sphere-frames';
import type { DrawnCoordSphereFrame } from '../../galactic/coord-spheres/coord-sphere';
import { EV_MAX_STOPS, EV_STEP_STOPS, steppedEv } from '../../hdr/exposure/exposure-epoch';
import { DETAIL_LEVELS } from '../../scene/scene-elements';
import { fmtDist, onUnitChange, getUnit } from '../../ui/distance-util';
import { bindStopControl, syncStopControl } from '../../ui/stop-control';
import { bindConstellationTypeahead } from '../../typeahead/constellation-typeahead';

const SPECT_LABELS: { key: string; label: string; bit: number }[] = [
  { key: 'O', label: 'O', bit: 0 },
  { key: 'B', label: 'B', bit: 1 },
  { key: 'A', label: 'A', bit: 2 },
  { key: 'F', label: 'F', bit: 3 },
  { key: 'G', label: 'G', bit: 4 },
  { key: 'K', label: 'K', bit: 5 },
  { key: 'M', label: 'M', bit: 6 },
  { key: 'C', label: 'C/S/W', bit: 7 },
  { key: '?', label: '?', bit: 8 },
];

export const DIST_MIN_PC = 0.01;
export const DIST_MAX_PC = 50_000;
const DIST_LOG_MIN = Math.log10(DIST_MIN_PC);
const DIST_LOG_MAX = Math.log10(DIST_MAX_PC);
const DIST_RANGE = DIST_LOG_MAX - DIST_LOG_MIN;
export const SLIDER_STEPS = 1000;

export function sliderToDist(v: number, isMin: boolean): number {
  if (isMin && v === 0) return 0;
  return 10 ** (DIST_LOG_MIN + (v / SLIDER_STEPS) * DIST_RANGE);
}

export function distToSlider(pc: number, isMin: boolean): number {
  if (isMin && pc <= 0) return 0;
  if (pc <= 0) return 0;
  const v = ((Math.log10(pc) - DIST_LOG_MIN) / DIST_RANGE) * SLIDER_STEPS;
  return Math.max(0, Math.min(SLIDER_STEPS, Math.round(v)));
}

/** Photography convention: signed stops with a sign on non-zero values,
 *  plus what the observer can actually perceive at that trim — a
 *  correctly-vanishing star field otherwise reads as a bug. */
export function evLabel(ev: number, effectiveLimitMag: number): string {
  const stops = ev === 0 ? '0' : `${ev > 0 ? '+' : '−'}${Math.abs(ev).toFixed(2)}`;
  return `${stops} EV · stars to m ${effectiveLimitMag.toFixed(1)}`;
}

export function bindControls(stellata: Stellata) {
  const distMin = document.getElementById('dist-min') as HTMLInputElement;
  const distMax = document.getElementById('dist-max') as HTMLInputElement;
  const distReadout = document.getElementById('dist-readout')!;
  const detailStops = document.querySelectorAll<HTMLButtonElement>('.detail-stop');
  const coordSphereStops = document.querySelectorAll<HTMLButtonElement>('.coord-sphere-stop');
  const chipsHost = document.getElementById('spect-chips')!;
  const spectAllBtn = document.getElementById('spect-all')!;
  const spectNoneBtn = document.getElementById('spect-none')!;
  const distUnitLabel = document.getElementById('dist-unit-label');
  const showHud = document.getElementById('show-hud') as HTMLInputElement;
  const showChart = document.getElementById('show-chart') as HTMLInputElement;
  const fov = document.getElementById('fov') as HTMLInputElement;
  const fovReadout = document.getElementById('fov-readout')!;
  const exag = document.getElementById('exag') as HTMLInputElement;
  const ev = document.getElementById('ev') as HTMLInputElement;
  const evReadout = document.getElementById('ev-readout')!;

  distMin.max = String(SLIDER_STEPS);
  distMax.max = String(SLIDER_STEPS);

  bindConstellationTypeahead(stellata);

  // Spectral chips (static).
  const chipEls: HTMLButtonElement[] = [];
  for (const { key, label, bit } of SPECT_LABELS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.class = key;
    btn.dataset.bit = String(bit);
    btn.textContent = label;
    btn.addEventListener('click', () => {
      const mask = stellata.filters.getFilter().spectMask ^ (1 << bit);
      stellata.filters.setFilter({ spectMask: mask });
    });
    chipEls.push(btn);
    chipsHost.appendChild(btn);
  }
  spectAllBtn.addEventListener('click', (e) => {
    e.preventDefault();
    stellata.filters.setFilter({ spectMask: ALL_SPECT_MASK });
  });
  spectNoneBtn.addEventListener('click', (e) => {
    e.preventDefault();
    stellata.filters.setFilter({ spectMask: 0 });
  });

  // Slider → filter.
  distMin.addEventListener('input', () => {
    let vMin = Number(distMin.value);
    let vMax = Number(distMax.value);
    if (vMin > vMax) { vMin = vMax; distMin.value = String(vMin); }
    stellata.filters.setFilter({
      minDistSol: sliderToDist(vMin, true),
      maxDistSol: sliderToDist(vMax, false),
    });
  });
  distMax.addEventListener('input', () => {
    let vMin = Number(distMin.value);
    let vMax = Number(distMax.value);
    if (vMax < vMin) { vMax = vMin; distMax.value = String(vMax); }
    stellata.filters.setFilter({
      minDistSol: sliderToDist(vMin, true),
      maxDistSol: sliderToDist(vMax, false),
    });
  });
  bindStopControl(detailStops, 'detail', DETAIL_LEVELS,
    (level) => stellata.filters.applyDetailPreset(level));
  bindStopControl(coordSphereStops, 'coordSphere', COORD_SPHERE_FRAMES,
    (frame) => stellata.filters.setFilter({ coordSphere: frame }));
  showHud.addEventListener('change', () => {
    stellata.filters.setFilter({ showHud: showHud.checked });
  });
  showChart.addEventListener('change', () => {
    stellata.filters.setFilter({ chart: showChart.checked });
  });

  fov.addEventListener('input', () => {
    stellata.setCameraFov(Number(fov.value));
  });
  document.getElementById('fov-reset')!.addEventListener('click', () => {
    stellata.setCameraFov(DEFAULT_FOV);
  });
  // Bounds come from the constants so the calibrated default stays
  // mid-track (`filters/filter-state.ts`).
  exag.min = String(STAR_K_MULTIPLIER_MIN);
  exag.max = String(STAR_K_MULTIPLIER_MAX);
  exag.step = String(STAR_K_MULTIPLIER_STEP);
  exag.addEventListener('input', () => {
    stellata.filters.setStarKMultiplier(Number(exag.value));
  });
  document.getElementById('exag-reset')!.addEventListener('click', () => {
    stellata.filters.setStarKMultiplier(stellata.filters.getStarKMultiplierDefault());
  });
  // The trim's grid is also the URL field's quantisation, so it comes
  // from the constants rather than from the markup.
  ev.min = String(-EV_MAX_STOPS);
  ev.max = String(EV_MAX_STOPS);
  ev.step = String(EV_STEP_STOPS);
  // Snapped, not raw: a range input's own step arithmetic can drift off
  // the grid (stepUp accumulation), and 0 is the value the readout
  // formats without a sign.
  ev.addEventListener('input', () => {
    stellata.exposure.setEv(steppedEv(Number(ev.value), 0));
  });
  document.getElementById('ev-reset')!.addEventListener('click', () => {
    stellata.exposure.setEv(0);
  });

  // Reverse sync: any filter change (user input, URL restore, presets) updates
  // DOM to match. Writing to .value does not re-dispatch 'input', so no loop.
  const syncFromFilter = () => {
    const f = stellata.filters.getFilter();
    const sMin = distToSlider(f.minDistSol, true);
    const sMax = distToSlider(f.maxDistSol, false);
    if (distMin.value !== String(sMin)) distMin.value = String(sMin);
    if (distMax.value !== String(sMax)) distMax.value = String(sMax);
    distReadout.textContent = `${fmtDist(f.minDistSol)} – ${fmtDist(f.maxDistSol)}`;

    syncStopControl(detailStops, 'detail', f.detailLevel);

    for (const el of chipEls) {
      const bit = Number(el.dataset.bit);
      el.classList.toggle('on', (f.spectMask & (1 << bit)) !== 0);
    }

    if (showHud.checked !== f.showHud) {
      showHud.checked = f.showHud;
    }
    syncStopControl(coordSphereStops, 'coordSphere', f.coordSphere);
    // Chart toggle is observe-gated. Disable when not in observe so the
    // user sees why it can't be enabled (the title attribute on the row
    // explains it).
    const observeMode = stellata.focus.getCameraMode() === 'observe';
    showChart.disabled = !observeMode;
    if (showChart.checked !== f.chart) showChart.checked = f.chart;
    const fovVal = stellata.filters.getCameraFov();
    const fovStr = String(Math.round(fovVal));
    if (fov.value !== fovStr) fov.value = fovStr;
    fovReadout.textContent = `${Math.round(fovVal)}°`;

    const kStr = stellata.filters.getStarKMultiplier().toString();
    if (exag.value !== kStr) exag.value = kStr;

    const evVal = stellata.exposure.getEv();
    if (Math.abs(Number(ev.value) - evVal) > 1e-6) ev.value = String(evVal);
    syncEvReadout();
  };

  // Adaptation moves every frame, so the readout can't ride the discrete
  // mutation events the rest of the panel syncs on. Write-on-change keeps
  // it off the per-frame DOM path.
  const syncEvReadout = () => {
    const text = evLabel(stellata.exposure.getEv(), stellata.exposure.getEffectiveLimitMag());
    if (evReadout.textContent !== text) evReadout.textContent = text;
  };

  // A stop whose frame describes nothing from the focused object is disabled
  // rather than hidden, with the row's title carrying why. What is available
  // turns on the focus alone, so this rides that event rather than the
  // per-frame path the Sol-distance version needed.
  const syncCoordSphereStops = () => {
    // The whole row is inert in navigate, where nothing draws a grid — the
    // attitude indicator carries the frame there instead.
    const observing = stellata.focus.getCameraMode() === 'observe';
    for (const btn of coordSphereStops) {
      const frame = btn.dataset.coordSphere;
      if (frame === undefined) continue;
      btn.disabled = !observing
        || (frame !== 'none'
          && !stellata.coordSphereAvailable(frame as DrawnCoordSphereFrame));
    }
  };
  stellata.on('focus', syncCoordSphereStops);
  stellata.on('cameraMode', syncCoordSphereStops);
  syncCoordSphereStops();

  stellata.on('filter', syncFromFilter);
  stellata.on('cameraMode', syncFromFilter);
  stellata.on('frame', syncEvReadout);
  onUnitChange(() => {
    if (distUnitLabel) distUnitLabel.textContent = getUnit();
    syncFromFilter();
  });
  if (distUnitLabel) distUnitLabel.textContent = getUnit();
  syncFromFilter();
}
