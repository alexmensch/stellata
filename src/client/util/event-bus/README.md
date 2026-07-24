# Event bus

`EventBus` — typed publish/subscribe used by `stellata.ts` to fan out
state changes to overlays, controllers, and the URL-sync module.
The canonical event list + payload map (`StellataEventMap`) is
declared in `stellata.ts` since that's where the events emit; the
class here is the generic transport.

The contract is intentionally minimal:

- `on(name, fn)` returns an unsubscribe; call it to detach.
- `emit(name, payload)` is synchronous; handlers must not throw
  (caught + reported in a one-line console warning).
- `clear()` detaches every subscription — wired into `Stellata.dispose`
  so cross-session subscriptions don't leak (representative
  authoring-pattern finding; see `docs/authoring-patterns.md`
  § Lifecycle pairing).

`index.ts` re-exports from `event-bus.ts` so consumers can keep their
existing `from './util/event-bus'` imports working.

## Who must capture the unsubscribe

Most subscribers don't, and that's correct — but the split is a rule,
not an accident of whichever sibling you copied:

- **Mounted for the lifetime of `Stellata` may omit the unsub.**
  Release happens via `clear()` inside `Stellata.dispose()`. This is
  the majority: overlays, panel widgets, labels, chart mode, URL sync.
- **Anything with its own mount/unmount lifecycle MUST capture the
  returned unsubscribe and call it during teardown** — debug HUDs
  (`../../debug/`), the warp-tuning panel, modal-scoped overlays, the
  focus-card rolodex, anything that can be torn down while `Stellata`
  keeps running. Omitting it there leaks a handler per mount cycle and
  the stale closure keeps writing to detached DOM.

The tell is whether the subscriber's own teardown function exists. If
it does, the unsub belongs in it.

## Authoring a new event

Payload types live in `StellataEventMap` (`../../stellata.ts`, where
the events emit). A payload type must never include `void` in a
union: `void | T` resolves to the payload-less `emit` overload and the
compiler then refuses the payload argument. Model an optional payload
as `T | undefined`.
