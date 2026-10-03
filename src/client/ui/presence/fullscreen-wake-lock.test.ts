// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindFullscreenWakeLock } from './fullscreen-wake-lock';

class FakeSentinel extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}

describe('bindFullscreenWakeLock', () => {
  let controller: AbortController;
  let fullscreen: Element | null;
  let visibility: DocumentVisibilityState;
  let sentinels: FakeSentinel[];
  let request: ReturnType<typeof vi.fn>;
  let pending: Array<() => void>;
  let deferRequests: boolean;

  const setFullscreen = (on: boolean) => {
    fullscreen = on ? document.documentElement : null;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  const setVisibility = (v: DocumentVisibilityState) => {
    visibility = v;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  const held = () => sentinels.filter((s) => !s.released);

  beforeEach(() => {
    controller = new AbortController();
    fullscreen = null;
    visibility = 'visible';
    sentinels = [];
    pending = [];
    deferRequests = false;
    request = vi.fn(() => new Promise<FakeSentinel>((resolve) => {
      const grant = () => {
        const s = new FakeSentinel();
        sentinels.push(s);
        resolve(s);
      };
      if (deferRequests) pending.push(grant);
      else grant();
    }));
    Object.defineProperty(document, 'fullscreenElement', { get: () => fullscreen, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true });
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  });

  afterEach(() => {
    controller.abort();
    Reflect.deleteProperty(document, 'fullscreenElement');
    Reflect.deleteProperty(document, 'visibilityState');
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  it('acquires on entering fullscreen and releases on exit', async () => {
    bindFullscreenWakeLock(controller.signal);
    expect(request).not.toHaveBeenCalled();
    setFullscreen(true);
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    expect(held()).toHaveLength(1);
    setFullscreen(false);
    await flush();
    expect(held()).toHaveLength(0);
  });

  it('does not request a second lock while one is held or pending', async () => {
    bindFullscreenWakeLock(controller.signal);
    deferRequests = true;
    setFullscreen(true);
    setFullscreen(true);
    expect(request).toHaveBeenCalledTimes(1);
    pending.shift()?.();
    await flush();
    setFullscreen(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(held()).toHaveLength(1);
  });

  it('releases a lock granted after fullscreen already exited', async () => {
    bindFullscreenWakeLock(controller.signal);
    deferRequests = true;
    setFullscreen(true);
    setFullscreen(false);
    pending.shift()?.();
    await flush();
    expect(sentinels).toHaveLength(1);
    expect(held()).toHaveLength(0);
  });

  it('re-acquires when the page becomes visible again in fullscreen', async () => {
    bindFullscreenWakeLock(controller.signal);
    setFullscreen(true);
    await flush();
    visibility = 'hidden';
    await sentinels[0]!.release();
    setVisibility('hidden');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(held()).toHaveLength(1);
  });

  it('does not re-acquire on visibility when not fullscreen', async () => {
    bindFullscreenWakeLock(controller.signal);
    setVisibility('hidden');
    setVisibility('visible');
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it('swallows a refused request and can retry on the next entry', async () => {
    request.mockRejectedValueOnce(new DOMException('refused', 'NotAllowedError'));
    bindFullscreenWakeLock(controller.signal);
    setFullscreen(true);
    await flush();
    expect(held()).toHaveLength(0);
    setFullscreen(false);
    setFullscreen(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(held()).toHaveLength(1);
  });

  it('releases the held lock on teardown', async () => {
    bindFullscreenWakeLock(controller.signal);
    setFullscreen(true);
    await flush();
    controller.abort();
    await flush();
    expect(held()).toHaveLength(0);
  });

  it('is inert where the API is missing', () => {
    Reflect.deleteProperty(navigator, 'wakeLock');
    expect(() => bindFullscreenWakeLock(controller.signal)).not.toThrow();
    setFullscreen(true);
    expect(request).not.toHaveBeenCalled();
  });
});
