// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_CURSOR_ATTR, IDLE_CURSOR_MS, bindIdleCursor } from './idle-cursor';

const isIdle = () => document.documentElement.hasAttribute(IDLE_CURSOR_ATTR);

const move = (x: number, y: number) =>
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));

describe('bindIdleCursor', () => {
  let controller: AbortController;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    controller = new AbortController();
    bindIdleCursor(controller.signal);
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it('hides the cursor after the idle delay with no pointer activity', () => {
    vi.advanceTimersByTime(IDLE_CURSOR_MS - 1);
    expect(isIdle()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isIdle()).toBe(true);
  });

  it('shows the cursor on a real move and restarts the delay', () => {
    vi.advanceTimersByTime(IDLE_CURSOR_MS);
    move(10, 20);
    expect(isIdle()).toBe(false);
    vi.advanceTimersByTime(IDLE_CURSOR_MS - 1);
    expect(isIdle()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isIdle()).toBe(true);
  });

  it('ignores a pointermove at the last recorded position', () => {
    move(10, 20);
    vi.advanceTimersByTime(IDLE_CURSOR_MS);
    move(10, 20);
    expect(isIdle()).toBe(true);
    move(11, 20);
    expect(isIdle()).toBe(false);
  });

  it('shows the cursor on pointerdown even without movement', () => {
    move(10, 20);
    vi.advanceTimersByTime(IDLE_CURSOR_MS);
    window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 20 }));
    expect(isIdle()).toBe(false);
  });

  it('sees activity whose propagation a target handler stops', () => {
    const stop = (e: Event) => e.stopPropagation();
    document.body.addEventListener('pointermove', stop);
    vi.advanceTimersByTime(IDLE_CURSOR_MS);
    document.body.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 5, bubbles: true }));
    document.body.removeEventListener('pointermove', stop);
    expect(isIdle()).toBe(false);
  });

  it('hides IDLE_CURSOR_MS after the last of a run of moves', () => {
    vi.advanceTimersByTime(IDLE_CURSOR_MS / 2);
    move(1, 1);
    vi.advanceTimersByTime(IDLE_CURSOR_MS - 1);
    expect(isIdle()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isIdle()).toBe(true);
  });

  it('touches the root and the timer queue only on a shown/hidden flip', () => {
    const root = document.documentElement;
    const writes = [vi.spyOn(root, 'setAttribute'), vi.spyOn(root, 'removeAttribute')];
    const arms = vi.spyOn(globalThis, 'setTimeout');
    const written = () => writes.reduce((n, s) => n + s.mock.calls.length, 0);
    const step = 16;
    for (let t = 0; t < IDLE_CURSOR_MS * 2; t += step) {
      move(t, t);
      vi.advanceTimersByTime(step);
    }
    expect(written()).toBe(0);
    expect(arms).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(IDLE_CURSOR_MS);
    expect(written()).toBe(1);
    move(1, 2);
    move(3, 4);
    expect(written()).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('clears the attribute and stops the timer on teardown', () => {
    vi.advanceTimersByTime(IDLE_CURSOR_MS);
    controller.abort();
    expect(isIdle()).toBe(false);
    move(1, 1);
    vi.advanceTimersByTime(IDLE_CURSOR_MS);
    expect(isIdle()).toBe(false);
  });
});
