# Render watch — why is this scene rendering?

`debug.renderWatch()` toggles a corner HUD that names the reason the
render gate is drawing, or not drawing, right now. It answers the
question the perf HUD structurally cannot: the perf HUD lives in the
debug panel, and **the panel holds the gate open**, so no section inside
it can ever observe idling.

```
src/client/debug/render-watch/
  render-watch-pure.ts (+ test)  The verdict table + the health line.
  render-watch.ts                HUD DOM, the 'frame' subscription, its
                                 own rAF tick counter, mount/dispose.
```

## The invariant: it must never hold the gate

This is the whole reason it is a standalone toggle rather than a tenth
panel section. It subscribes to `'frame'`, counts rAF ticks in a loop of
its own, and reads two debug-scoped getters
(`RenderGate.debugState`, `Stellata.cadenceDebugState`). It calls neither
`hold()` nor `invalidate()`, and it touches nothing on the canvas — a
`pointermove` over the canvas would wake the gate, so the HUD is
`pointer-events: none`. Adding any wake path to this module destroys the
only thing it measures.

Toggling it on while the panel is open logs a warning rather than
silently reporting "every tick renders".

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
