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
                                 CSS, the gap-sample cap.
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

## What the numbers mean

- **`hold budget`** — the most **model** time that may pass before the
  frame has to be redrawn. Not wall-clock time: `sim-s` is seconds on the
  clock the scrubber drives, so at live rate one sim-second is one real
  second, and at 100× fast-forward the same budget elapses 100× sooner
  (the cadence idles only at or under live rate, so in practice the two
  coincide). It is the largest step that nothing drawn can turn into a
  visible change, where "visible" means a quarter of a device pixel of
  on-screen motion or 1 % of a body's own flux.
- **`set by`** — which of the four sources is binding: **on-screen
  motion** (the fastest thing actually drawn), **a brightness ramp** (an
  eclipse dip in progress), **the pulsation bound** (the catalogue's
  fastest variable — 32.4 s on the shipped data, just above the cap, so
  it never actually binds), or **the 30 s cap**.
- **`reported`** — the frame's rate report itself, in the units the
  layers file it in: CSS px per sim second and flux fraction per sim
  second. Divide the threshold by it and you have the budget above.
- **`observed`** — what actually moved, measured independently of the
  rate model. This is the safety net's input
  (`../../render-gate/README.md` § The safety net); when it exceeds a
  visible step on a *scheduled* frame, `trust` drops and the headline
  turns red. **Printed as a rate, normalised over the gap it was
  measured across**, which is the only form comparable to `reported`
  directly above it — `CadenceReport` files the observed channels per
  GAP, and a raw per-gap figure beside a per-second one reads as the
  declaration over-reporting by whatever the frame interval happens to
  be. That misreading is not hypothetical: at 57 ms gaps the two rows
  sat three orders of magnitude apart while the estimator was accurate
  to 4 %. The gap itself is printed alongside so the raw observation is
  still recoverable.
- **`clean`** — appears on the pulsation line only after a violation:
  scheduled frames audited since the last one. Trust alone cannot say
  whether the net is recovering or still catching violations, because a
  held-down trust and a climbing one read identically.
- **`trust`** — the standing correction the net applies. 1.000 means
  every declaration has held up.

## The invariant: it must never hold the gate

This is the whole reason it is a standalone toggle rather than a tenth
panel section. It subscribes to `'frame'`, counts rAF ticks in a loop of
its own, and reads three debug-scoped getters
(`RenderGate.debugState`, `RenderGate.lastFrameWasCadenceScheduled`,
`Stellata.cadenceDebugState`). It calls neither `hold()` nor
`invalidate()`. Adding any wake path to this module destroys the only
thing it measures.

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

`classifyRenderWatch` runs the gate's **own decision order** — a live
net correction, then holds, then the continuous conditions, then the
cadence, then the tail — and imports `SETTLE_MS` and the cadence
thresholds rather than restating them, so the readout cannot name a
cause the gate would not have used, and cannot drift when a threshold
moves.

Three rows earn their place:

- **`skip ratio`** is what separates the two ways a low tick rate
  happens. Ticks slow *and* the gate skipping nothing can only be
  expensive frames; ticks slow *and* a high skip ratio is the browser
  deferring the loop (an unfocused window, Low Power Mode). The health
  line says which. Without it, one reads as the other — the trap that
  made an early version of this instrument label a 15 fps close-planet
  view "browser throttling".
- **`layers`** is the behaviour census. A non-zero `realtime` count is a
  regression whatever else is green, and
  `../../../../tests/cadence-layer-declarations.test.ts` fails on it.
- **`gap median … over N`** carries its own sample size, because the
  window is short on purpose (below).

### Three instrument bugs the first version had

All three made this HUD lie at exactly the vantages it exists for, and
all three are fixed here rather than worked around:

1. **The median gap was taken over a 120-second window.** One touch of
   the mouse left two minutes of 16 ms gaps in the sample, so the verdict
   read `NOT IDLING` for two minutes after every interaction. The sample
   is now **anchored on the last wake** — frames from before an
   interaction describe a regime that has ended — and cleared when the
   gate's `lastWake` timestamp changes.
2. **Every intended cadence frame counted as a hitch.** A gap over
   100 ms is a stall when frames are meant to be continuous and *is the
   feature* when the cadence scheduled it, so the hitch counter now skips
   any gap with a scheduled frame at either end
   (`RenderGate.lastFrameWasCadenceScheduled`). `worstGapMs` follows the
   same gate, so the health line no longer reports a 30-second idle as
   the worst hitch of the session.
3. **`medianOf` sorted a ~7200-element array five times a second** while
   rendering continuously. The window is now a count —
   `GAP_SAMPLE_COUNT` = 32 — which is several minutes of real idling and
   a sort nobody can measure. Fixes 1 and 3 share this change.

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

## `DECLARATION UNDER-REPORTED`

The one verdict that outranks a hold. The safety net saw something move
a visible step on a frame the cadence had scheduled, which means a layer
declared a rate lower than what its content actually did. The line names
the channel (motion or brightness), what was observed, what was allowed,
and the fraction the budget is being held at until the reports stop
disagreeing with the scene.

**A silent net would be worse than none**, which is why this sits at the
top of the order rather than being folded into the frame rate: a
shortened budget otherwise reads as the estimator being right about a
busy scene.
