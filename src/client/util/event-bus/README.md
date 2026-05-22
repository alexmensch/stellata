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
