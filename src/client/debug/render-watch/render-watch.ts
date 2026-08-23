// Standalone HUD answering "why is this scene rendering?". Takes NO gate
// hold — see README.md.

import type { Stellata } from '../../stellata';
import { SETTLE_MS } from '../../render-gate/render-gate-pure';
import { CADENCE_CAP_SIM_S } from '../../render-gate/cadence/clock-cadence-pure';
import { setReadoutText } from '../debug-panel';
import {
  GAP_SAMPLE_COUNT,
  bindingSourceLabel,
  classifyHealth,
  classifyRenderWatch,
  hudContainerCss,
  type RenderWatchTone,
} from './render-watch-pure';

const HITCH_MS = 100;
const REPAINT_MS = 200;
const FLASH_MS = 500;
const HEALTH_WINDOW_S = 5;

const TONE_COLOUR: Record<RenderWatchTone, string> = {
  idling: '#4ade80',
  'as-designed': '#60a5fa',
  transient: '#fbbf24',
  held: '#f87171',
  wrong: '#f87171',
  unknown: '#a3a3a3',
};

const fixed = (v: number, d = 2): string =>
  Number.isFinite(v) ? v.toFixed(d) : (v > 0 ? 'inf' : '—');

export interface RenderWatchOpts {
  /** Fired when the HUD's own close button dismisses it, so the owner can
   *  drop its handle. Not called by the returned disposer. */
  onClose?: () => void;
}

/** Mount the watcher. Returns an idempotent disposer. */
export function mountRenderWatch(stellata: Stellata, opts: RenderWatchOpts = {}): () => void {
  const hud = document.createElement('div');
  hud.id = 'stellata-render-watch';
  hud.style.cssText = hudContainerCss();

  // Only this element is clickable, so dragging across the readout to copy
  // values cannot dismiss the HUD — the pattern buildDiagnosticReadout's
  // reset link uses.
  const close = document.createElement('div');
  close.textContent = '[close]';
  close.title = 'close render watch';
  close.style.cssText = 'position:absolute;top:8px;right:9px;cursor:pointer;color:#999;'
    + 'user-select:none;-webkit-user-select:none;line-height:1';

  const head = document.createElement('div');
  head.style.cssText = 'font-weight:700;margin-bottom:2px;padding-right:52px';
  const sub = document.createElement('div');
  sub.style.cssText = 'margin-bottom:6px;color:#fbbf24;min-height:1em';
  const body = document.createElement('pre');
  body.style.cssText = 'margin:0;font:inherit';
  hud.append(close, head, sub, body);
  document.body.appendChild(hud);

  /** Gaps between consecutive rendered frames, newest last, capped at
   *  GAP_SAMPLE_COUNT and CLEARED on every wake — see § Reading it. */
  const gapsMs: number[] = [];
  const tickAt: number[] = [];
  const t0 = performance.now();
  let frames = 0;
  let ticks = 0;
  let hitches = 0;
  let worstGapMs = 0;
  let lastFrameAt = 0;
  /** Was the PREVIOUS rendered frame one the cadence scheduled? A gap that
   *  either end of scheduled is a gap the gate meant to leave. */
  let lastFrameScheduled = false;
  let lastWakeAtMs = Number.NEGATIVE_INFINITY;
  let flashTimer: number | null = null;
  // Wall-clock start of the current unbroken settle tail, so a tail that
  // never expires is distinguishable from one that keeps restarting.
  let tailSince: number | null = null;
  let disposed = false;

  const offFrame = stellata.on('frame', () => {
    const now = performance.now();
    const scheduled = stellata.renderGate.lastFrameWasCadenceScheduled;
    if (lastFrameAt !== 0) {
      const gap = now - lastFrameAt;
      // A scheduled cadence frame's gap is the feature, not a hitch. The
      // first version counted every intended 4-second idle as a >100 ms
      // stall, which made the health line unreadable at exactly the
      // vantages the cadence works best at.
      if (gap > HITCH_MS && !scheduled && !lastFrameScheduled) {
        hitches++;
        if (gap > worstGapMs) worstGapMs = gap;
      }
      gapsMs.push(gap);
      if (gapsMs.length > GAP_SAMPLE_COUNT) gapsMs.shift();
    }
    frames++;
    lastFrameAt = now;
    lastFrameScheduled = scheduled;
    hud.style.borderColor = TONE_COLOUR.idling;
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => { hud.style.borderColor = '#333'; }, FLASH_MS);
  });

  // Own rAF loop rather than a hook in animate(): it must keep counting on
  // the ticks the gate skips, which is what the skip ratio is.
  const countTick = () => {
    if (disposed) return;
    const now = performance.now();
    ticks++;
    tickAt.push(now);
    while (tickAt.length > 0 && now - tickAt[0] > HEALTH_WINDOW_S * 1000) tickAt.shift();
    requestAnimationFrame(countTick);
  };
  requestAnimationFrame(countTick);

  const repaint = () => {
    const now = performance.now();
    const gate = stellata.renderGate.debugState;
    const cadence = stellata.cadenceDebugState;
    const msSinceWake = now - gate.lastActiveMs;

    if (msSinceWake < SETTLE_MS) {
      if (tailSince === null) tailSince = now;
    } else {
      tailSince = null;
    }

    // Anchor the sample on the last wake. Frames from before an
    // interaction describe a regime that has ended, and keeping them was
    // what made this instrument report NOT IDLING for two minutes after
    // every touch of the mouse.
    const wakeAt = gate.lastWake?.atMs ?? Number.NEGATIVE_INFINITY;
    if (wakeAt !== lastWakeAtMs) {
      lastWakeAtMs = wakeAt;
      gapsMs.length = 0;
    }

    const verdict = classifyRenderWatch({
      holds: gate.holds,
      clockRate: cadence.clockRate,
      budgetSimS: cadence.budgetSimS,
      msSinceWake,
      tailHeldMs: tailSince === null ? 0 : now - tailSince,
      gapsMs,
      trust: cadence.trust.trust,
      violation: cadence.trust.lastViolation,
    });

    const tickHz = tickAt.length / HEALTH_WINDOW_S;
    const skipRatio = ticks > 0 ? 1 - frames / ticks : 0;

    head.style.color = TONE_COLOUR[verdict.tone];
    setReadoutText(head, verdict.reason);
    setReadoutText(sub, classifyHealth({ tickHz, skipRatio, hitches, worstGapMs }));

    const d = gate.lastDecision;
    const stampedBy = d === null ? '—'
      : d.continuous ? 'continuous (a camera transition, or a realtime layer)'
      : d.poseChanged ? `pose moved: ${d.poseSlot}`
      : d.cadenceDue ? 'the clock cadence (a scheduled redraw)'
      : 'nothing this tick';
    const wake = gate.lastWake;
    const r = cadence.report;

    setReadoutText(body, [
      `clock rate   ${cadence.clockRate}x    holds ${gate.holds}`
        + `    realtime ${cadence.realtimeNeeded ? 'YES' : 'no'}`,
      `layers       ${cadence.census.static} static · ${cadence.census.clock} clock`
        + ` · ${cadence.census.realtime} realtime`,
      '',
      `stamped by   ${stampedBy}`,
      `last wake    ${wake === null ? 'none' : `${wake.reason}`
        + `  (${((now - wake.atMs) / 1000).toFixed(1)}s ago)`}`,
      '',
      `hold budget  ${fixed(cadence.budgetSimS)} sim-s`,
      '  the most model time that may pass before a redraw',
      `  set by     ${bindingSourceLabel(
        r, cadence.pulsationBudgetS, cadence.pixelRatio)}`,
      `  reported   ${r.screenPxPerSimS.toPrecision(3)} css-px/s`
        + ` · ${r.fluxFracPerSimS.toPrecision(3)} flux/s`,
      `  pulsation  ${fixed(cadence.pulsationBudgetS, 1)}   cap ${CADENCE_CAP_SIM_S}`
        + `   trust ${fixed(cadence.trust.trust, 3)}`,
      `  expect     ${fixed(verdict.expectedGapMs / 1000)}s between frames`,
      '',
      `observed     ${r.observedPx.toPrecision(3)} css-px`
        + ` · ${r.observedFluxFrac.toPrecision(3)} flux, last gap`,
      `rAF ticks    ${tickHz.toFixed(1)}/s now   ${ticks} total`,
      `rendered     ${frames} total   skip ratio ${skipRatio.toFixed(4)}`,
      `gap median   ${fixed(verdict.medianGapMs / 1000, 3)}s over ${gapsMs.length}`
        + `   worst hitch ${fixed(worstGapMs / 1000, 2)}s`,
      `since frame  ${lastFrameAt === 0 ? '—' : ((now - lastFrameAt) / 1000).toFixed(1) + 's'}`,
      `model behind ${Number.isNaN(cadence.lastRenderedSimS)
        ? '—' : fixed(stellata.getT() - cadence.lastRenderedSimS, 1) + ' sim-s'}`,
      `elapsed      ${((now - t0) / 1000).toFixed(0)}s`,
    ].join('\n'));
  };
  repaint();
  const repaintTimer = window.setInterval(repaint, REPAINT_MS);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.clearInterval(repaintTimer);
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    offFrame();
    hud.remove();
  };
  close.addEventListener('click', () => {
    dispose();
    opts.onClose?.();
  });
  return dispose;
}
