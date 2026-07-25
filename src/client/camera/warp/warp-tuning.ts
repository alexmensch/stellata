// Warp-curve tuning section for the unified debug panel. Sliders write
// into `camera-config.ts`; the readout reads `warp-telemetry.ts`.

import type { Stellata } from '../../stellata';
import type { DebugSection } from '../../debug/debug-panel';
import { cameraConfig, setCameraConfig } from '../camera-config';
import { getLastWarp } from './warp-telemetry';

export function buildWarpSection(stellata: Stellata): DebugSection {
  let visible = true;

  const root = document.createElement('div');
  root.style.cssText =
    'font:11px/1.3 ui-monospace,monospace;background:rgba(0,0,0,.85);' +
    'color:#cfe;padding:6px 8px;border-radius:4px;min-width:280px;';

  // --- Sliders -----------------------------------------------------------
  const slidersBox = document.createElement('div');
  root.appendChild(slidersBox);

  function addSlider(opts: {
    label: string;
    min: number;
    max: number;
    step: number;
    initial: number;
    onChange: (v: number) => void;
    fmt?: (v: number) => string;
  }) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';
    const label = document.createElement('span');
    label.style.cssText = 'flex:0 0 90px;color:#aaa;';
    label.textContent = opts.label;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(opts.min);
    slider.max = String(opts.max);
    slider.step = String(opts.step);
    slider.value = String(opts.initial);
    slider.className = 'debug-slider';
    slider.style.cssText = 'flex:1;';
    const value = document.createElement('span');
    value.style.cssText = 'flex:0 0 60px;text-align:right;color:#fff;';
    const fmt = opts.fmt ?? ((v: number) => String(v));
    value.textContent = fmt(opts.initial);
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      opts.onChange(v);
      value.textContent = fmt(v);
    });
    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(value);
    slidersBox.appendChild(row);
  }

  const fmtMs = (v: number) => `${v.toFixed(0)} ms`;
  const fmtFrac = (v: number) => v.toFixed(2);
  const cfg = cameraConfig();

  addSlider({
    label: 'reorient',
    min: 200, max: 2000, step: 50,
    initial: cfg.reorientMs,
    onChange: (v) => setCameraConfig('reorientMs', v),
    fmt: fmtMs,
  });
  addSlider({
    label: 'fly t-min',
    min: 200, max: 8000, step: 100,
    initial: cfg.flyTMinMs,
    onChange: (v) => setCameraConfig('flyTMinMs', v),
    fmt: fmtMs,
  });
  addSlider({
    label: 'fly t-max',
    min: 1000, max: 20000, step: 200,
    initial: cfg.flyTMaxMs,
    onChange: (v) => setCameraConfig('flyTMaxMs', v),
    fmt: fmtMs,
  });
  addSlider({
    label: 'fly k',
    min: 0, max: 6000, step: 100,
    initial: cfg.flyTKMs,
    onChange: (v) => setCameraConfig('flyTKMs', v),
    fmt: fmtMs,
  });
  addSlider({
    label: 'phase 3',
    min: 200, max: 3000, step: 50,
    initial: cfg.observeTransitionMs,
    onChange: (v) => setCameraConfig('observeTransitionMs', v),
    fmt: fmtMs,
  });

  // Step 10 keeps the seam slider granular at the low end, where values
  // ≤ 1 degenerate to pure linear-d piecewise-quad and the perceptual
  // difference between neighbouring values is largest.
  addSlider({
    label: 'seam k',
    min: 0, max: 2000, step: 10,
    initial: cfg.arrivalHybridSeamK,
    onChange: (v) => setCameraConfig('arrivalHybridSeamK', v),
    fmt: (v) => v.toFixed(0),
  });

  addSlider({
    label: 'recentre',
    min: 0.1, max: 0.9, step: 0.01,
    initial: cfg.midFlyRecentreFrac,
    onChange: (v) => setCameraConfig('midFlyRecentreFrac', v),
    fmt: fmtFrac,
  });

  // --- Live readout ------------------------------------------------------
  const readoutHeader = document.createElement('div');
  readoutHeader.style.cssText = 'margin-top:6px;color:#888;border-top:1px solid #333;padding-top:4px;';
  readoutHeader.textContent = 'live';
  root.appendChild(readoutHeader);

  const readout = document.createElement('div');
  readout.style.cssText = 'white-space:pre;color:#cfe;';
  readout.textContent = '(idle)';
  root.appendChild(readout);

  // Per-readout dirty cache — skips DOM writes when the text is unchanged
  // (mirrors the perf-hud pattern). Cheap to maintain, and matters when
  // the section is expanded for many seconds across idle warps.
  let lastReadoutText = '';

  // Copy-pastable knob summary at the bottom. Updated when any knob
  // changes; click the value block to copy it. Lets Alex paste exact
  // constants back without retyping.
  const summaryBox = document.createElement('div');
  summaryBox.style.cssText =
    'margin-top:6px;padding-top:4px;border-top:1px solid #333;cursor:pointer;color:#9c9;';
  summaryBox.title = 'click to copy';
  summaryBox.addEventListener('click', () => {
    navigator.clipboard?.writeText(summaryBox.textContent ?? '').catch(() => {});
  });
  root.appendChild(summaryBox);

  function renderSummary() {
    const c = cameraConfig();
    summaryBox.textContent =
      `WARP_REORIENT_MS = ${c.reorientMs}\n` +
      `WARP_T_MIN_MS = ${c.flyTMinMs}\n` +
      `WARP_T_MAX_MS = ${c.flyTMaxMs}\n` +
      `WARP_T_K_MS = ${c.flyTKMs}\n` +
      `OBSERVE_TRANSITION_MS = ${c.observeTransitionMs}\n` +
      `ARRIVAL_HYBRID_SEAM_K = ${c.arrivalHybridSeamK.toFixed(0)}\n` +
      `MID_FLY_RECENTRE_FRAC = ${c.midFlyRecentreFrac.toFixed(2)}`;
  }
  renderSummary();
  // Re-render summary on any slider change. Cheaper than per-tick
  // because slider input is event-driven; debounce-free is fine.
  slidersBox.addEventListener('input', renderSummary);
  slidersBox.addEventListener('change', renderSummary);

  // --- Per-frame subscription -------------------------------------------
  // Dark-when-collapsed contract: early-return BEFORE any work when the
  // section isn't visible. No latches, no allocations.
  const onFrame = () => {
    if (!visible) return;
    const w = stellata.getWarpInfo();
    if (!w) {
      const lastWarp = getLastWarp();
      const lastBlock = lastWarp
        ? `\n\nlast warp: ${lastWarp.sourceKind}#${lastWarp.sourceIdx} → ` +
          `${lastWarp.destKind}#${lastWarp.destIdx}\n` +
          `  total ${lastWarp.totalMs.toFixed(0)} ms · ` +
          `plateau ${lastWarp.plateauFired ? 'Y' : 'N'}` +
          (lastWarp.plateauFired
            ? ` (d=${(lastWarp.plateauDistPc ?? 0).toFixed(3)} pc)`
            : '')
        : '';
      const text = '(idle)' + lastBlock;
      if (text !== lastReadoutText) {
        readout.textContent = text;
        lastReadoutText = text;
      }
      return;
    }
    // Active warp — assemble a single text block so we do one DOM write.
    const phase = stellata.getWarpPhase();
    if (!phase) return;
    const distCam = stellata.camera.position.distanceTo(w.B);
    // Regime indicator on the phase line — outer / inner during Fly,
    // 'done' once Fly completes and post-arrival starts. Reads the
    // hybrid curve's outer→inner seam captured at warp start.
    const phaseStr = phase.kind === 'fly' && phase.flyRegime
      ? `fly:${phase.flyRegime}`
      : phase.kind === 'post-arrival'
        ? 'post-arrival (done)'
        : phase.kind;
    const seamStr = phase.flyArrivalUSeam != null && phase.flyArrivalUSeam >= 0
      ? `  seam ${phase.flyArrivalUSeam.toFixed(3)}`
      : '';
    const text =
      `phase: ${phaseStr}  ${phase.elapsedMs.toFixed(0)} / ${phase.totalMs.toFixed(0)} ms\n` +
      `u: ${phase.u.toFixed(3)}${seamStr}\n` +
      `cam → dest: ${distCam.toFixed(distCam < 1 ? 4 : 2)} pc\n` +
      `recentred: ${phase.recenteredToDest ? 'Y' : 'N'}  plateau: ${
        phase.chartPlateauDist != null ? phase.chartPlateauDist.toFixed(3) + ' pc' : '—'
      }  fired: ${phase.chartPlateauTriggered ? 'Y' : 'N'}`;
    if (text !== lastReadoutText) {
      readout.textContent = text;
      lastReadoutText = text;
    }
  };

  const unsubscribe = stellata.on('frame', onFrame);

  return {
    element: root,
    dispose: () => {
      unsubscribe();
    },
    setVisible: (v: boolean) => {
      visible = v;
    },
  };
}
