# Presence

Two behaviours keyed on whether someone is actively at the screen, one
module each: `idle-cursor.ts` and `fullscreen-wake-lock.ts` (+ tests). Both are bound in `main.ts` straight after the page
teardown exists, before boot, and take its `signal` — so they run on the
loading screen too, and `pagehide` removes every listener, clears the timer
and releases the lock.

## Idle cursor

`bindIdleCursor` adds `html.idle-cursor` after `IDLE_CURSOR_MS` (2 s)
without pointer activity, everywhere in the app and in or out of
fullscreen. `styles.css` turns that class into `cursor: none !important` on
`<html>` and every descendant; the `!important` is what beats the inline
`cursor` the debug panels write.

- **Activity is a `pointermove` to a new position, or any `pointerdown`.**
  Chrome dispatches synthetic moves at an unchanged position when layout
  shifts or the element under a stationary cursor changes — which the
  animating scene and the hover tooltip do constantly — so a move matching
  the last recorded `clientX`/`clientY` is ignored. The last position starts
  as `NaN`, so the first real move always counts.
- Both listeners sit on `window` in the capture phase, so a canvas or
  panel handler that stops propagation cannot hide activity from it.
- Keyboard input is not activity: the cursor stays hidden while flying with
  the keys.
- **Only the cursor hides.** The `#controls-restore-btn` label and the star
  tooltip keep their own rules; nothing else keys on `idle-cursor`.

## Fullscreen wake lock

`bindFullscreenWakeLock` holds a Screen Wake Lock — the browser request
that stops the display dimming or sleeping — while
`document.fullscreenElement` is set and the page is visible. It listens to
`fullscreenchange` and `visibilitychange` only; the fullscreen toggle itself
is `../fullscreen.ts`, which knows nothing of this.

- **Best-effort.** Feature-detected with `'wakeLock' in navigator`; a
  refused request (battery saver, Low Power Mode, an insecure context) is
  swallowed and retried on the next fullscreen entry or visibility return.
  Needs a secure context: HTTPS or `localhost`.
- **Lock state is `released | requesting | held`**, never a nullable
  sentinel: a request still in flight blocks a second one, and a lock
  granted after fullscreen already exited is released on arrival.
- The browser auto-releases the lock when the page is hidden; the
  sentinel's `release` event returns the state to `released`, and the
  `visibilitychange` back to visible re-acquires it if still fullscreen.
