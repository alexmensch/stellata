import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createHoverEngine } from './hover-engine';
import type { HoverHit, HoverKind, HoverPayload, HoverProvider } from './hover-types';

const DELAY_MS = 280;
const VIEWPORT = { innerWidth: 1000, innerHeight: 800 };
// Mirrors the `--page-margin-*` values the stubbed root reports below.
const MARGIN_X = 14;
const MARGIN_BOTTOM = 16;

// Minimal DOM stubs — vitest runs the node environment for this project,
// so `window`, canvas, and the tooltip element are all hand-rolled
// (pattern mirrors perf-hud.test.ts / hud-overlay.test.ts).
type PointerLike = { clientX: number; clientY: number };

function makeCanvas() {
  const listeners = new Map<string, (e: PointerLike) => void>();
  const removed: string[] = [];
  const canvas = {
    addEventListener(type: string, fn: (e: PointerLike) => void) {
      listeners.set(type, fn);
    },
    removeEventListener(type: string) {
      removed.push(type);
      listeners.delete(type);
    },
  } as unknown as HTMLCanvasElement;
  const fire = (type: string, e: PointerLike = { clientX: 0, clientY: 0 }) => {
    const fn = listeners.get(type);
    if (!fn) throw new Error(`no listener bound for '${type}'`);
    fn(e);
  };
  return { canvas, listeners, removed, fire };
}

// `rect` is a function of the card's current `left` so a test can model
// shrink-to-fit: a card parked near the right edge has less room and
// wraps taller. The engine must measure at the origin, before it clamps.
function makeTooltip(rect: (left: number) => { width: number; height: number } = () => ({
  width: 200,
  height: 60,
})) {
  const style = {} as Record<string, string>;
  const tooltip = {
    hidden: true,
    innerHTML: '',
    style: style as unknown as CSSStyleDeclaration,
    getBoundingClientRect: () => rect(parseFloat(style.left ?? '0') || 0),
  } as unknown as HTMLElement & { hidden: boolean; innerHTML: string };
  return { tooltip, style };
}

const HIT: HoverHit = { idx: 7, cameraDistancePc: 1, tier: 'prime' };

function makeProvider(
  kind: HoverKind,
  hit: HoverHit | null = HIT,
  payload: HoverPayload | null = { name: 'Vega', lines: ['7.7 pc'] },
): HoverProvider {
  return { kind, pick: vi.fn(() => hit), format: vi.fn(() => payload) };
}

// Spied so the dispose test can assert the dwell timer is cancelled: an
// engine whose providers are already emptied walks nothing when a leaked
// timer fires, so the cancellation isn't observable any other way.
let clearTimeoutSpy: MockInstance;

describe('hover-engine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    (globalThis as { window?: unknown }).window = {
      ...VIEWPORT,
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: number) => clearTimeout(id),
    };
    const rootStyle = {
      getPropertyValue: (name: string) =>
        ({
          '--page-margin-x': `${MARGIN_X}px`,
          '--page-margin-top': '10px',
          '--page-margin-bottom': `${MARGIN_BOTTOM}px`,
        })[name] ?? '',
    };
    (globalThis as { document?: unknown }).document = { documentElement: {} };
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => rootStyle;
  });

  afterEach(() => {
    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { getComputedStyle?: unknown }).getComputedStyle;
  });

  it('walks providers after the dwell delay and shows the card', () => {
    const { canvas, fire } = makeCanvas();
    const { tooltip } = makeTooltip();
    const star = makeProvider('star');
    createHoverEngine({ canvas, tooltip, initialProviders: [star] });

    fire('pointermove', { clientX: 100, clientY: 100 });
    expect(star.pick).not.toHaveBeenCalled();
    expect(tooltip.hidden).toBe(true);

    vi.advanceTimersByTime(DELAY_MS);
    expect(star.pick).toHaveBeenCalledWith(100, 100, 14);
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.innerHTML).toBe(
      '<div class="tt-name">Vega</div><div class="tt-sub">7.7 pc</div>',
    );
  });

  it('a pointerdown before the timer fires suppresses the hover', () => {
    const { canvas, fire } = makeCanvas();
    const { tooltip } = makeTooltip();
    const star = makeProvider('star');
    createHoverEngine({ canvas, tooltip, initialProviders: [star] });

    fire('pointermove', { clientX: 100, clientY: 100 });
    fire('pointerdown');
    vi.advanceTimersByTime(DELAY_MS * 4);
    expect(star.pick).not.toHaveBeenCalled();
    expect(tooltip.hidden).toBe(true);

    // Drags stay suppressed until pointerup releases the latch.
    fire('pointermove', { clientX: 120, clientY: 120 });
    vi.advanceTimersByTime(DELAY_MS);
    expect(star.pick).not.toHaveBeenCalled();

    fire('pointerup');
    fire('pointermove', { clientX: 140, clientY: 140 });
    vi.advanceTimersByTime(DELAY_MS);
    expect(star.pick).toHaveBeenCalledTimes(1);
  });

  it('pointerleave hides the card and cancels a pending walk', () => {
    const { canvas, fire } = makeCanvas();
    const { tooltip } = makeTooltip();
    const star = makeProvider('star');
    createHoverEngine({ canvas, tooltip, initialProviders: [star] });

    fire('pointermove', { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(DELAY_MS);
    expect(tooltip.hidden).toBe(false);

    fire('pointermove', { clientX: 110, clientY: 110 });
    fire('pointerleave');
    expect(tooltip.hidden).toBe(true);
    vi.advanceTimersByTime(DELAY_MS * 4);
    expect(star.pick).toHaveBeenCalledTimes(1);
  });

  it('register dedupes by reference; unregister drops the provider', () => {
    const { canvas, fire } = makeCanvas();
    const { tooltip } = makeTooltip();
    const star = makeProvider('star');
    const cloud = makeProvider('cloud', null);
    const engine = createHoverEngine({ canvas, tooltip });

    engine.register(star);
    engine.register(star);
    engine.register(cloud);
    fire('pointermove', { clientX: 1, clientY: 1 });
    vi.advanceTimersByTime(DELAY_MS);
    expect(star.pick).toHaveBeenCalledTimes(1);
    expect(cloud.pick).toHaveBeenCalledTimes(1);

    engine.unregister(cloud);
    fire('pointermove', { clientX: 2, clientY: 2 });
    vi.advanceTimersByTime(DELAY_MS);
    expect(star.pick).toHaveBeenCalledTimes(2);
    expect(cloud.pick).toHaveBeenCalledTimes(1);
  });

  it('dispose hides a showing card, drops every listener, empties the registry', () => {
    const { canvas, listeners, removed, fire } = makeCanvas();
    const { tooltip } = makeTooltip();
    const star = makeProvider('star');
    const engine = createHoverEngine({ canvas, tooltip, initialProviders: [star] });

    fire('pointermove', { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(DELAY_MS);
    expect(tooltip.hidden).toBe(false);

    // Held across dispose to stand in for a listener some other holder
    // still references: the registry must be empty, not just detached.
    const staleMove = listeners.get('pointermove')!;
    engine.dispose();

    expect(tooltip.hidden).toBe(true);
    expect(removed.sort()).toEqual([
      'pointerdown',
      'pointerleave',
      'pointermove',
      'pointerup',
    ]);
    expect(listeners.size).toBe(0);

    staleMove({ clientX: 110, clientY: 110 });
    vi.advanceTimersByTime(DELAY_MS);
    expect(star.pick).toHaveBeenCalledTimes(1);

    engine.register(star);
    expect(() => engine.dispose()).not.toThrow();
  });

  it('dispose cancels a dwell timer still in flight', () => {
    const { canvas, fire } = makeCanvas();
    const { tooltip } = makeTooltip();
    const star = makeProvider('star');
    const engine = createHoverEngine({ canvas, tooltip, initialProviders: [star] });

    fire('pointermove', { clientX: 100, clientY: 100 });
    clearTimeoutSpy.mockClear();
    engine.dispose();
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DELAY_MS * 4);
    expect(star.pick).not.toHaveBeenCalled();
  });

  it('renders nothing when the winning provider formats to null', () => {
    const { canvas, fire } = makeCanvas();
    const { tooltip } = makeTooltip();
    const star = makeProvider('star', HIT, null);
    createHoverEngine({ canvas, tooltip, initialProviders: [star] });

    fire('pointermove', { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(DELAY_MS);
    expect(star.format).toHaveBeenCalledTimes(1);
    expect(tooltip.hidden).toBe(true);
  });

  it('offsets the card from the cursor away from the viewport edges', () => {
    const { canvas, fire } = makeCanvas();
    const { tooltip, style } = makeTooltip();
    createHoverEngine({ canvas, tooltip, initialProviders: [makeProvider('star')] });

    fire('pointermove', { clientX: 100, clientY: 200 });
    vi.advanceTimersByTime(DELAY_MS);
    expect(style.left).toBe('114px');
    expect(style.top).toBe('214px');
  });

  it('clamps to the measured size inset by the shared page margins', () => {
    const { canvas, fire } = makeCanvas();
    const { tooltip, style } = makeTooltip((left) => ({
      width: 200,
      height: left > 0 ? 300 : 60,
    }));
    createHoverEngine({ canvas, tooltip, initialProviders: [makeProvider('star')] });

    // Twice: the second show is the one that matters. Its measure has a
    // leftover `left` from the first, and an engine that measured in
    // place would read the 300px wrapped height and clamp against that.
    fire('pointermove', { clientX: 990, clientY: 790 });
    vi.advanceTimersByTime(DELAY_MS);
    fire('pointermove', { clientX: 990, clientY: 790 });
    vi.advanceTimersByTime(DELAY_MS);
    // The card lands at the same inset the fixed chrome containers use,
    // not flush against the viewport edge.
    expect(style.left).toBe(`${1000 - 200 - MARGIN_X}px`);
    expect(style.top).toBe(`${800 - 60 - MARGIN_BOTTOM}px`);
  });
});
