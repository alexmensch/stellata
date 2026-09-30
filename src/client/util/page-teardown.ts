/** Page-lifetime teardown: the GPU holder's release and the dev-console globals (util/README.md). */

export interface PageTeardown<N> {
  hold(release: () => void): void;
  expose<K extends keyof N>(name: K, value: N[K]): void;
}

export function bindPageTeardown<N extends object>(
  target: EventTarget & Partial<N>,
  reload: () => void,
): PageTeardown<N> {
  const globals: Partial<N> = target;
  let release: (() => void) | null = null;
  let released = false;
  const exposed = new Set<keyof N>();
  target.addEventListener('pagehide', () => {
    for (const name of exposed) Reflect.deleteProperty(globals, name);
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
      globals[name] = value;
      exposed.add(name);
    },
  };
}
