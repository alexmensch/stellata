# Render watch — why is this scene rendering?

`debug.renderWatch()` toggles a corner HUD that names the reason the
render gate is drawing, or not drawing, right now. It answers the
question the perf HUD structurally cannot: the perf HUD lives in the
debug panel, and **the panel holds the gate open**, so no section inside
it can ever observe idling.

```
src/client/debug/render-watch/
  render-watch-pure.ts (+ test)  The verdict table, the binding-source
                                 label, the health line, the container
                                 CSS.
  render-watch.ts                HUD DOM, the 'frame' subscription, its
                                 own rAF tick counter, mount/dispose.
  render-watch-section.ts        The panel section that hands off to it.
```

## Starting it from the panel

The **Render watch** section (first in the panel) has one button, and it
**closes the panel** before mounting the watcher — in that order, because
the panel's gate hold is exactly what the watcher cannot see past. The
HUD's own `[close]` link dismisses it and does *not* reopen the panel.
`debug.renderWatch()` remains the console toggle; all three paths share
one handle, so the section's button label and the console toggle stay in
step with whatever is actually on screen.

## What the two budget numbers mean

- **`hold budget`** — the most **model** time that may pass before the
  frame has to be redrawn. Not wall-clock time: `sim-s` is seconds on the
  clock the scrubber drives, so at live rate one sim-second is one real
  second, and at 100× fast-forward the same budget elapses 100× sooner.
  It is the largest step that nothing drawn can turn into a visible
  change, where "visible" means half a device pixel of on-screen motion
  or 0.01 magnitudes of brightness.
- **`set by` / `layers · pulsation · cap`** — the budget is the smallest
  of three, and this names which one is currently binding.
  **`pulsation`** is the variable-star bound: stars in the catalogue that
  cycle in brightness would, at their fastest, take this many model
  seconds to shift by 0.01 magnitudes — the smallest brightness step a
  viewer would notice. On the shipped catalogue it reads **32.4**, just
  above the 30 s cap, so it never actually binds; a catalogue refresh
  bringing in a faster variable would make it the limit, and
  `tests/cadence-idle-floor.test.ts` fails if that happens unnoticed.
  **`layers`** is the min over the per-layer hooks (planet bodies,
  probes, binaries), and is what collapses near a moving body.

## The invariant: it must never hold the gate

This is the whole reason it is a standalone toggle rather than a tenth
panel section. It subscribes to `'frame'`, counts rAF ticks in a loop of
its own, and reads two debug-scoped getters
(`RenderGate.debugState`, `Stellata.cadenceDebugState`). It calls neither
`hold()` nor `invalidate()`. Adding any wake path to this module destroys
the only thing it measures.

Toggling it on while the panel is open logs a warning rather than
silently reporting "every tick renders".

## Why it absorbs pointer events

`pointer-events: auto`, which reads like the risky choice and is the safe
one. The gate's wake listeners are on the **canvas**
(`../../render-gate/render-gate.ts` `attachDom`), so `none` would pass
every pointer move in this corner straight through the HUD to the canvas
and wake the gate being watched. Absorbing them is the quiet option, and
it is what makes the readout selectable — worth having, because these
numbers get copied into bug reports.

Selection opt-in follows the panel's pattern: `body` sets
`user-select: none` and UI chrome opts back in, with the `-webkit-`
property written explicitly because Safari does not reliably inherit it
(`../../styles.css`). `hudContainerCss` is pure so the invariant is
pinned by test rather than by comment.

Selectable CSS is only half of it — a readout that rewrites its own
`textContent` five times a second replaces the text node and collapses
the selection every time, so dragging across it is impossible. Every
write goes through **`setReadoutText`** (`../debug-panel.ts`), which
holds the write while a selection touches the element and dedupes
unchanged text. The readout therefore freezes while you have text
selected in it, which is the desired behaviour: you are reading a
snapshot in order to copy it.

Two consequences: the HUD's rectangle does not pass clicks to the scene
(the debug panel behaves the same way), and **⌘C wakes the gate** — the
window-level `keydown` listener is a wake path, so copying the readout
buys a 1500 ms settle tail. The numbers you copied are from before it.

## Reading it

The border **flashes green on every rendered frame** — at the default Sol
view that is one flash, then half a minute dark. The verdict line is
coloured by tone: green idling, blue rendering-every-tick-as-specified,
amber transient, red wrong-or-held, grey still collecting.

`classifyRenderWatch` runs the gate's **own decision order** — holds,
then the continuous conditions, then the cadence, then the tail — and
imports `SETTLE_MS` and `CADENCE_MIN_IDLE_GAP_REAL_S` from the gate
rather than restating them, so the readout cannot name a cause the gate
would not have used, and cannot drift when a threshold moves.

Two rows earn their place:

- **`skip ratio`** is what separates the two ways a low tick rate
  happens. Ticks slow *and* the gate skipping nothing can only be
  expensive frames; ticks slow *and* a high skip ratio is the browser
  deferring the loop (an unfocused window, Low Power Mode). The health
  line says which. Without it, one reads as the other — the trap that
  made an early version of this instrument label a 15 fps close-planet
  view "browser throttling".
- **`ride`** flags a frame on which the focal ride translated the camera.
  While it says yes the budget is halved, because no layer prices the
  camera's own motion (`../../render-gate/README.md` § The focal ride).

## `TAIL NEVER EXPIRES`

A settle tail is a 1500 ms burst that ends. One that has been
continuously unexpired for `STUCK_TAIL_MS` (three tails' worth) is not
settling — something stamps activity every tick. The verdict switches
from amber `SETTLE TAIL` to red, because the two look identical in any
instrument that only samples "ms since wake" and the distinction is the
whole diagnosis.

That case is not hypothetical: the focal ride wrote the camera below the
gate, so the next tick read it as a fresh camera move and stamped
activity, forever, at any vantage. It presented for minutes as a settle
tail. `render-watch` exists partly so that shape is named on sight
instead of re-derived.
