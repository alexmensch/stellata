// Standalone HUD answering "why is this scene rendering?". Takes NO gate
// hold — see README.md.

import type { Stellata } from '../../stellata';
import { SETTLE_MS } from '../../render-gate/render-gate-pure';
import {
  classifyHealth,
  classifyRenderWatch,
  type RenderWatchTone,
} from './render-watch-pure';

const GAP_WINDOW_MS = 120_000;
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

function styleHud(el: HTMLElement): void {
  el.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;pointer-events:none;'
    + 'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(0,0,0,.85);'
    + 'color:#e8e8e8;padding:9px 11px;border-radius:6px;border:2px solid #333;min-width:330px';
}

const fixed = (v: number, d = 2): string =>
  Number.isFinite(v) ? v.toFixed(d) : (v > 0 ? 'inf' : '—');

/** Mount the watcher. Returns its disposer. */
export function mountRenderWatch(stellata: Stellata): () => void {
  const hud = document.createElement('div');
  hud.id = 'stellata-render-watch';
  styleHud(hud);
  const head = document.createElement('div');
  head.style.cssText = 'font-weight:700;margin-bottom:2px';
  const sub = document.createElement('div');
  sub.style.cssText = 'margin-bottom:6px;color:#fbbf24;min-height:1em';
  const body = document.createElement('pre');
  body.style.cssText = 'margin:0;font:inherit';
  hud.append(head, sub, body);
  document.body.appendChild(hud);

  const frameAt: number[] = [];
  const tickAt: number[] = [];
  const t0 = performance.now();
  let frames = 0;
  let ticks = 0;
  let hitches = 0;
  let worstGapMs = 0;
  let lastFrameAt = 0;
  let flashTimer: number | null = null;
  // Wall-clock time the current unbroken settle tail started, so a tail
  // that never expires is distinguishable from one that keeps restarting.
  let tailSince: number | null = null;

  const offFrame = stellata.on('frame', () => {
    const now = performance.now();
    if (lastFrameAt !== 0) {
      const gap = now - lastFrameAt;
      if (gap > HITCH_MS) hitches++;
      if (gap > worstGapMs) worstGapMs = gap;
    }
    frames++;
    lastFrameAt = now;
    frameAt.push(now);
    while (frameAt.length > 0 && now - frameAt[0] > GAP_WINDOW_MS) frameAt.shift();
    hud.style.borderColor = TONE_COLOUR.idling;
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => { hud.style.borderColor = '#333'; }, FLASH_MS);
  });

  // Own rAF loop rather than a hook in animate(): it must keep counting on
  // the ticks the gate skips, which is the whole point of the skip ratio.
  let running = true;
  const countTick = () => {
    if (!running) return;
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

    const gapsMs: number[] = [];
    for (let i = 1; i < frameAt.length; i++) gapsMs.push(frameAt[i] - frameAt[i - 1]);

    const verdict = classifyRenderWatch({
      holds: gate.holds,
      clockRate: cadence.clockRate,
      budgetSimS: cadence.budgetSimS,
      msSinceWake,
      tailHeldMs: tailSince === null ? 0 : now - tailSince,
      gapsMs,
      rideMoved: cadence.rideMoved,
    });

    const tickHz = tickAt.length / HEALTH_WINDOW_S;
    const renderedHz = frameAt.filter((s) => now - s < HEALTH_WINDOW_S * 1000).length
      / HEALTH_WINDOW_S;
    const skipRatio = ticks > 0 ? 1 - frames / ticks : 0;

    head.textContent = verdict.reason;
    head.style.color = TONE_COLOUR[verdict.tone];
    sub.textContent = classifyHealth({ tickHz, skipRatio, hitches, worstGapMs });

    const simStale = cadence.lastRenderedSimS;
    body.textContent = [
      `rate       ${cadence.clockRate}x     holds ${gate.holds}`
        + `     ride ${cadence.rideMoved ? 'yes' : 'no'}`,
      `budget     ${fixed(cadence.budgetSimS)} sim-s -> expect `
        + `${fixed(verdict.expectedGapMs / 1000)}s gaps`,
      `           pulsation ${fixed(cadence.pulsationBudgetS, 1)}`,
      `rAF        ${tickHz.toFixed(1)}/s now    ${ticks} total`,
      `rendered   ${renderedHz.toFixed(2)}/s now    ${frames} total`,
      `skip ratio ${skipRatio.toFixed(4)}`,
      `gap median ${fixed(verdict.medianGapMs / 1000, 3)}s   worst `
        + `${fixed(worstGapMs / 1000, 2)}s`,
      `since frame ${lastFrameAt === 0 ? '—' : ((now - lastFrameAt) / 1000).toFixed(1) + 's'}`,
      `sim stale  ${Number.isNaN(simStale) ? '—' : fixed(stellata.getT() - simStale, 1)} sim-s`,
      `elapsed    ${((now - t0) / 1000).toFixed(0)}s`,
    ].join('\n');
  };
  repaint();
  const repaintTimer = window.setInterval(repaint, REPAINT_MS);

  return () => {
    running = false;
    window.clearInterval(repaintTimer);
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    offFrame();
    hud.remove();
  };
}
