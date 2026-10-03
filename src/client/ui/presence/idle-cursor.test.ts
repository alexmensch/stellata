// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_CURSOR_CLASS, IDLE_CURSOR_MS, bindIdleCursor } from './idle-cursor';

const isIdle = () => document.documentElement.classList.contains(IDLE_CURSOR_CLASS);

const move = (x: number, y: number) =>
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));

describe('bindIdleCursor', () => {
  let controller: AbortController;

  beforeEach(() => {
    vi.useFakeTimers();
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

  it('clears the class and stops the timer on teardown', () => {
    vi.advanceTimersByTime(IDLE_CURSOR_MS);
    controller.abort();
    expect(isIdle()).toBe(false);
    move(1, 1);
    vi.advanceTimersByTime(IDLE_CURSOR_MS);
    expect(isIdle()).toBe(false);
  });
});
