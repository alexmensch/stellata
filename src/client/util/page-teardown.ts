/** Page-lifetime teardown of whatever holds the GPU device (util/README.md). */

export interface PageTeardown {
  hold(release: () => void): void;
}

export function bindPageTeardown(target: EventTarget, reload: () => void): PageTeardown {
  let release: (() => void) | null = null;
  let released = false;
  target.addEventListener('pagehide', () => {
    if (released || release === null) return;
    released = true;
    release();
  });
  target.addEventListener('pageshow', (event) => {
    if (released && (event as PageTransitionEvent).persisted) reload();
  });
  return {
    hold(next) {
      release = next;
    },
  };
}
