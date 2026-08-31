# Event bus

`EventBus` — typed publish/subscribe used by `stellata.ts` to fan out
state changes to overlays, controllers, and the URL-sync module.
The canonical event list + payload map (`StellataEventMap`) is
declared in `stellata.ts` since that's where the events emit; the
class here is the generic transport.

The contract is intentionally minimal:

- `on(name, fn)` returns an unsubscribe; call it to detach.
- `emit(name, payload)` is synchronous; handlers must not throw, and one
  that does is contained — caught per handler and reported in a one-line
  `console.warn`, with every later subscriber still delivered to. That
  containment is deliberately **unlike** the scene registry's fan-outs
  (`../fan-out.ts`), which collect and rethrow: an emitter owns its
  operation and must hear about a failure, while subscribers are mutually
  anonymous and a bus has nowhere honest to propagate one subscriber's
  failure to. This paragraph described behaviour the code did not have
  until 2026-08; a throwing handler used to take every handler registered
  after it, for the rest of the session.
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

## `frame` fires AFTER the render, and that rules it out for a camera write

It fires once per **rendered** frame, elided on a tick the render gate skips
(`../../render-gate/README.md`), and it fires *after* the draw. So a handler
that writes the camera there lands on a frame already on screen: the write
shows up one frame later, and anything the frame drew from the camera —
including that handler's own instrument — disagrees with it in the meantime.

**The bus is the wrong seam for that write, not just the wrong event.** Where
in the frame a camera write belongs is an ordering claim about other layers
(after the position writes, before the projectors), and the scene registry is
the only place that can express it — `../../scene/README.md` § Not every entry
owns a layer. The orbit lock is the worked example: it rides through
`Stellata.setOrbitLockRide` from a sequencing-only registry entry, and only
its *drawing* rides `frame` (`../../attitude/orbit-frame/README.md` § The lock).

## Authoring a new event

Payload types live in `StellataEventMap` (`../../stellata.ts`, where
the events emit). A payload type must never include `void` in a
union: `void | T` resolves to the payload-less `emit` overload and the
compiler then refuses the payload argument. Model an optional payload
as `T | undefined`.
