// Generic typed pub/sub. `M` is an event-name → payload-type map; the
// compiler enforces handler/payload alignment per event.
// See src/client/util/event-bus/README.md.

type NoPayloadKeys<M> = {
  [K in keyof M]: M[K] extends void ? K : never;
}[keyof M];
type WithPayloadKeys<M> = Exclude<keyof M, NoPayloadKeys<M>>;

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

  // Split overloads, not a conditional rest tuple: `frame` emits once per
  // render at 60–120 Hz and a rest parameter allocates an array per call.
  // Map-authoring constraint (no `void` in a payload union) in ./README.md.
  emit<K extends NoPayloadKeys<M>>(name: K): void;
  emit<K extends WithPayloadKeys<M>>(name: K, payload: M[K]): void;
  // Contained per handler, not collected and rethrown like the scene
  // registry's fan-outs (`../fan-out.ts`): an emitter is not the owner of
  // its subscribers, so one subscriber's failure must not surface as the
  // emitter's. Subscribers are mutually anonymous — before this, a throw
  // took every handler registered after it, for the rest of the session.
  emit(name: keyof M, payload?: unknown): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const h of set) {
      try {
        (h as (p: unknown) => void)(payload);
      } catch (err) {
        console.warn(`EventBus: handler for '${String(name)}' threw`, err);
      }
    }
  }

  // Detach every subscriber across every event. Called from
  // `Stellata.dispose()` so HMR teardown can release the closures that
  // would otherwise pin the previous Stellata instance through this bus.
  clear(): void {
    this.handlers.clear();
  }
}
