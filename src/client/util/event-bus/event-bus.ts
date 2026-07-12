// Generic typed pub/sub. `M` is an event-name → payload-type map; the
// compiler enforces handler/payload alignment per event.
// See src/client/util/event-bus/README.md.

export class EventBus<M extends Record<string, unknown>> {
  private handlers = new Map<keyof M, Set<(payload: never) => void>>();

  on<K extends keyof M>(name: K, handler: (payload: M[K]) => void): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    const slot = set;
    slot.add(handler as (payload: never) => void);
    return () => {
      slot.delete(handler as (payload: never) => void);
    };
  }

  // Conditional rest tuple omits the payload arg entirely for `void` events,
  // so `bus.emit('frame')` and `bus.emit('focus', idx)` both type-check
  // against the same signature. Consequence for the map: a payload type
  // must never include `void` in a union — `void | T` matches the
  // no-payload branch and the compiler then refuses the payload arg.
  // Model an optional payload as `T | undefined` instead.
  emit<K extends keyof M>(
    name: K,
    ...rest: M[K] extends void ? [] : [M[K]]
  ): void {
    const payload = rest[0] as M[K];
    const set = this.handlers.get(name);
    if (!set) return;
    for (const h of set) (h as (p: M[K]) => void)(payload);
  }

  // Detach every subscriber across every event. Called from
  // `Stellata.dispose()` so HMR teardown can release the closures that
  // would otherwise pin the previous Stellata instance through this bus.
  clear(): void {
    this.handlers.clear();
  }
}
