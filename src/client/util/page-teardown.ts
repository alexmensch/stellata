/** Page-lifetime teardown: the GPU holder's release and the dev-console globals (util/README.md). */

export interface PageTeardown<G> {
  hold(release: () => void): void;
  expose<K extends keyof G>(name: K, value: G[K]): void;
}

export function bindPageTeardown<G extends EventTarget>(
  target: G,
  reload: () => void,
): PageTeardown<G> {
  let release: (() => void) | null = null;
  let released = false;
  const exposed = new Set<keyof G>();
  target.addEventListener('pagehide', () => {
    for (const name of exposed) Reflect.deleteProperty(target, name);
    exposed.clear();
    if (released || release === null) return;
    released = true;
    // WebKit keeps a reloaded page's global alive, and this listener with it.
    const run = release;
    release = null;
    run();
  });
  target.addEventListener('pageshow', (event) => {
    if (released && (event as PageTransitionEvent).persisted) reload();
  });
  return {
    hold(next) {
      release = next;
    },
    expose(name, value) {
      target[name] = value;
      exposed.add(name);
    },
  };
}
