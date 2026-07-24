// Hover-label engine — canvas pointer listener, dwell timer, provider
// registry, #tooltip render. See ./README.md.

import { escapeHtml } from '../ui/dom-util';
import { readPageMargins } from '../ui/page-margins';
import {
  disambiguateHits,
  type HoverProviderHit,
} from './hover-pick-disambiguator';
import type { HoverProvider } from './hover-types';

// Hover trigger constants. Held here so the engine is self-contained
// and so a future debug-panel toggle can flip the cadence without
// crawling call sites.
const DEFAULT_DELAY_MS = 280;
const DEFAULT_PX_THRESHOLD = 14;

// Near-cursor offset — far enough that the cursor doesn't sit on the
// tooltip and trigger pointerleave on the canvas, close enough that
// the tooltip reads as attached to the cursor.
const TOOLTIP_CURSOR_OFFSET_PX = 14;

export type HoverEngineConfig = {
  canvas: HTMLCanvasElement;
  tooltip: HTMLElement;
  pxThreshold?: number;
  delayMs?: number;
  initialProviders?: HoverProvider[];
};

export type HoverEngine = {
  register(p: HoverProvider): void;
  unregister(p: HoverProvider): void;
  dispose(): void;
};

export function createHoverEngine(config: HoverEngineConfig): HoverEngine {
  const {
    canvas,
    tooltip,
    pxThreshold = DEFAULT_PX_THRESHOLD,
    delayMs = DEFAULT_DELAY_MS,
    initialProviders = [],
  } = config;

  const providers: HoverProvider[] = [...initialProviders];
  const margins = readPageMargins();
  let timer: number | undefined;
  let dragging = false;
  // Scratch array reused per tick so the disambiguator doesn't allocate
  // a fresh array on every fire. Capped at the registered-provider
  // count; cleared between ticks.
  const hits: HoverProviderHit[] = [];

  const hide = () => {
    tooltip.hidden = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const renderPayload = (clientX: number, clientY: number, winner: HoverProviderHit) => {
    const payload = winner.provider.format(winner.hit);
    if (payload === null) return;
    const { name, lines } = payload;
    const subLines = lines
      .map((l) => `<div class="tt-sub">${escapeHtml(l)}</div>`)
      .join('');
    tooltip.innerHTML = `<div class="tt-name">${escapeHtml(name)}</div>${subLines}`;
    // Measure the laid-out card rather than clamping against hand-copied
    // CSS numbers. The origin park is load-bearing: the card is
    // shrink-to-fit, so measuring at the previous position would size it
    // against whatever viewport space remained there and read a taller
    // box than it will occupy once clamped.
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    tooltip.hidden = false;
    const { width, height } = tooltip.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - margins.x;
    const maxTop = window.innerHeight - height - margins.bottom;
    tooltip.style.left = Math.min(clientX + TOOLTIP_CURSOR_OFFSET_PX, maxLeft) + 'px';
    tooltip.style.top = Math.min(clientY + TOOLTIP_CURSOR_OFFSET_PX, maxTop) + 'px';
  };

  const onPointerDown = () => {
    dragging = true;
    hide();
  };
  const onPointerUp = () => {
    dragging = false;
  };
  const onPointerLeave = () => hide();
  const onPointerMove = (e: PointerEvent) => {
    if (dragging) return;
    const x = e.clientX;
    const y = e.clientY;
    hide();
    timer = window.setTimeout(() => {
      hits.length = 0;
      for (const provider of providers) {
        const hit = provider.pick(x, y, pxThreshold);
        if (hit !== null) hits.push({ provider, hit });
      }
      const winner = disambiguateHits(hits);
      if (winner === null) return;
      renderPayload(x, y, winner);
    }, delayMs);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointermove', onPointerMove);

  return {
    register(p: HoverProvider) {
      if (!providers.includes(p)) providers.push(p);
    },
    unregister(p: HoverProvider) {
      const i = providers.indexOf(p);
      if (i >= 0) providers.splice(i, 1);
    },
    dispose() {
      hide();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointermove', onPointerMove);
      providers.length = 0;
    },
  };
}
