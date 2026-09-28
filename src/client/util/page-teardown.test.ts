import { describe, expect, it, vi } from 'vitest';
import { bindPageTeardown } from './page-teardown';

function pageshow(persisted: boolean): Event {
  return Object.assign(new Event('pageshow'), { persisted });
}

function make() {
  const target = new EventTarget();
  const reload = vi.fn();
  const teardown = bindPageTeardown(target, reload);
  return { target, reload, teardown };
}

describe('bindPageTeardown', () => {
  it('runs the held release on pagehide', () => {
    const { target, teardown } = make();
    const release = vi.fn();
    teardown.hold(release);
    target.dispatchEvent(new Event('pagehide'));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('runs only the most recently held release', () => {
    const { target, teardown } = make();
    const first = vi.fn();
    const second = vi.fn();
    teardown.hold(first);
    teardown.hold(second);
    target.dispatchEvent(new Event('pagehide'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('releases once across repeated pagehides', () => {
    const { target, teardown } = make();
    const release = vi.fn();
    teardown.hold(release);
    target.dispatchEvent(new Event('pagehide'));
    target.dispatchEvent(new Event('pagehide'));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reloads a page the back/forward cache restores after a release', () => {
    const { target, reload, teardown } = make();
    teardown.hold(vi.fn());
    target.dispatchEvent(new Event('pagehide'));
    target.dispatchEvent(pageshow(true));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves a restored page alone when nothing was held to release', () => {
    const { target, reload } = make();
    target.dispatchEvent(new Event('pagehide'));
    target.dispatchEvent(pageshow(true));
    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores a pageshow that is not a cache restore', () => {
    const { target, reload, teardown } = make();
    teardown.hold(vi.fn());
    target.dispatchEvent(new Event('pagehide'));
    target.dispatchEvent(pageshow(false));
    expect(reload).not.toHaveBeenCalled();
  });
});
