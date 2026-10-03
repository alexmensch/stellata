# Presence

Two behaviours keyed on whether someone is actively at the screen, one
module each: `idle-cursor.ts` and `fullscreen-wake-lock.ts` (+ tests). Both are bound in `main.ts` straight after the
shell's `teardown.hold(...)` and take the teardown's `signal`, so
`pagehide` removes every listener, clears the timer and releases the lock.
**Bind after a `hold`, never before:** a page restored from the
back/forward cache is reloaded only when something was held, so listeners
bound earlier and aborted by a `pagehide` mid-boot stay dead in the
restored page ([`page-teardown.ts`](../../util/README.md)).

## Idle cursor

`bindIdleCursor` sets `data-idle-cursor` on `<html>` after `IDLE_CURSOR_MS`
(2 s) without pointer activity, everywhere in the app and in or out of
fullscreen — a state flag on the root, the same shape as
`body[data-controls-hidden]`. `styles.css` turns it into `cursor: none !important` on
`<html>` and every descendant; the `!important` is what beats the inline
`cursor` the debug panels write.

- **Activity is a `pointermove` to a new position, or any `pointerdown`.**
  Chrome dispatches synthetic moves at an unchanged position when layout
  shifts or the element under a stationary cursor changes — which the
  animating scene and the hover tooltip do constantly — so a move matching
  the last recorded `clientX`/`clientY` is ignored. The last position starts
  as `NaN`, so the first real move always counts.
- **The root is written only on a flip.** State is `shown` (one timer
  armed) or `hidden` (none). Activity while shown only records
  `performance.now()`; the timer, on firing, re-arms for whatever is left
  of the 2 s since the last activity, or hides. A steadily moving mouse
  therefore costs one timestamp per event and one timer per 2 s, and the
  `:root[data-idle-cursor] *` restyle runs twice per idle cycle.
- Both listeners sit on `window` in the capture phase, so a canvas or
  panel handler that stops propagation cannot hide activity from it.
- Keyboard input is not activity: the cursor stays hidden while flying with
  the keys.
- **Only the cursor hides.** The `#controls-restore-btn` label and the star
  tooltip keep their own rules; nothing else keys on `data-idle-cursor`.

## Fullscreen wake lock

`bindFullscreenWakeLock` holds a Screen Wake Lock — the browser request
that stops the display dimming or sleeping — while
`document.fullscreenElement` is set and the page is visible. It listens to
`fullscreenchange` and `visibilitychange` only; the fullscreen toggle itself
is `../fullscreen.ts`, which knows nothing of this.

- **Best-effort.** Feature-detected with `'wakeLock' in navigator`; a
  refused request (battery saver, Low Power Mode, an insecure context) is
  swallowed and retried on the next fullscreen entry or visibility return;
  a refusal fires no `release`, so it cannot loop.
  Needs a secure context: HTTPS or `localhost`.
- **Lock state is `released | requesting | held`**, never a nullable
  sentinel: a request still in flight blocks a second one, and a lock
  granted after fullscreen already exited is released on arrival.
- **`reconcile` is the one place that decides whether the lock is
  wanted**, and every edge runs it: `fullscreenchange`,
  `visibilitychange`, and the sentinel's own `release` event. So a lock
  the browser drops while the page is still fullscreen and visible is
  re-requested at once, and one dropped because the page went hidden
  comes back on the `visibilitychange` to visible. A lock this module
  releases itself never re-enters: `release()` moves the state off `held`
  before the event fires.
