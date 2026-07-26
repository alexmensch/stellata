# Simulation time

Simulation time `t`, the `VirtualClock` behind `Stellata.getT()`, the
UTC readout, and the transport scrubber widget. This folder is the
**single source of truth for wall-clock sampling** — nothing else in the
codebase reads `Date.now()` for the model clock.

## Files in this area

```
src/client/solar-system/time/
  time.ts (+ test)                Simulation time `t` + the UTC ↔ Julian-day
                                  and TDB helpers (§ Timescales). Owns
                                  VirtualClock, the clock behind
                                  Stellata.getT(), plus the FF/RW rate
                                  transitions, rate label, and the
                                  TRANSPORT_BUTTONS action spec. Single
                                  source of truth for the scrubber.
  time-readout.ts (+ test)        UTC readout display next to the time
                                  scrubber.
  time-scrubber-widget.ts         First-class scrubber in the bottom-right
    (+ -pure, + pure test)        meta slot (T key / click the readout).
                                  Transport controls (play/pause/FF/RW/reset)
                                  over the VirtualClock, built from
                                  TRANSPORT_BUTTONS; app-styled, with a
                                  human "time / second" rate readout
                                  (formatRatePerSecond, pure + tested).
```

## Time `t` and the readout

`time.ts` defines `t` as a Unix-seconds double. `Stellata.getT()` reads
it from a `VirtualClock`: `t = simT0 + rate · (wallNow − wallT0)`, so at
`rate = 1` in steady state it tracks `Date.now() / 1000` exactly (the
parity every existing consumer relies on). This is the ONLY place
wall-clock is sampled for the simulation `t`.

The scrubber widget (`time-scrubber-widget.ts`) drives the clock:
play / pause / fast-forward / rewind / reset / jump-to-date. FF and RW
step through **powers of two** (`±1, ±2, … ±2³²`) and cross zero directly
— a step from `+1×` lands on `-1×` rather than passing through fractional
slow-motion, since the binary orbits this scrubber verifies (α Cen 80 yr,
61 Cyg 664 yr) are only ever watched *faster* than wall-clock. Rate flips
snapshot the current virtual time so scrubbing never teleports. `|rate|`
saturates at `2³²` (~4.29e9×). `Stellata.setT(n)` freezes the clock at a
specific instant (URL-restore of a scrubbed view); `setT(null)` resets to
live.

`t` itself is clamped to the Standish ephemeris validity window
(3000 BC – 3000 AD; `T_CLAMP_MIN_S` / `T_CLAMP_MAX_S`) — every clock
mutation and `getT()` read clamps, so no consumer ever sees an epoch
where planet positions (or linear star propagation) are garbage. The
Horizons element tables span a much narrower 1900–2100 and do not move
this bound: outside them the ephemeris falls back to the series the
clamp is named for (`../ephemerides/README.md`). A
running clock **pins at the bound** with its rate intact: the readout
freezes there, no invisible overshoot accrues (the clock re-anchors at
the bound), and the first opposite-direction transport step moves off
it immediately. See SCIENCE.md § Solar system for the decision record.

## Timescales

`t` runs in **UTC**, and `tToJDE` / `jdeToT` are the exact inverse pair
that carry it to and from a Julian Date in that same scale. Everything
whose epoch argument is a wall-clock instant — the readout, the scrubber,
the star-catalogue epoch advance, binary orbits — reads that pair.

**The ephemerides do not.** JPL's element tables and the Standish series
are both defined against **TDB**, which runs `TT_MINUS_UTC_S` = 69.184 s
ahead of UTC (32.184 s of TT − TAI plus the 37 leap seconds in force
since 2017). `tToJdTdb` / `jdTdbToT` add and remove that offset, and
`../ephemerides/` reads through them exclusively — planets and moons
alike. Feeding a UTC-scale JD to the element evaluation instead moves
Mercury by 2.2e-5 AU, which was the dominant term left once the element
tables landed. The offset is held constant rather than tabulated:
leap seconds accrued at a few seconds per decade, and ±5 s of drift is
1.6e-6 AU at Mercury, three orders under the tables' own bound.

Jump-to-date is a native `datetime-local` input whose value is
read as **local** time (`toLocalDatetimeValue` / `parseLocalDatetimeValue`
in `time.ts`), even though the readout displays UTC — deliberate, so it
matches the operator's wall clock. The calendar-popup indicator is hidden
in CSS (`.scrubber-jump input::-webkit-calendar-picker-indicator`): the
segmented fields are typed by hand, avoiding both the out-of-place native
picker and the format-error trap of a plain text box. Reset already snaps
to live-now at 1×, so there is intentionally no separate "now" jump.

`time-readout.ts` renders the live UTC timestamp the rendered positions
correspond to. It mounts the collapsed `.meta` readout (`#time-readout`, a
button that opens the scrubber); while the scrubber is expanded, that
readout is hidden and the scrubber's own readout takes over. Either way the
current model time stays on screen in every mode (free fly, chart, warp,
observe) — binary orbital evolution ticks against `getT()` throughout, so
the user always benefits from knowing which moment is being rendered.

Format is plain-English UTC: `D MMM YYYY, HH:MM:SS UTC`
(e.g. `7 May 2026, 18:23:45 UTC`). Locale-independent — month
abbreviations are hard-coded en-US to avoid DD/MM vs MM/DD ambiguity
across browsers.

**Variable-star pulsation runs on `t`.** It was once driven by a separate
cosmetic `uTime` real-seconds clock, deliberately decoupled from `t`; that
decision is now reversed. Pulsation phase reads the model clock through
`uModelDays` (= days since J2000 from `getT()`) at real GCVS periods, so it
responds to the time-warp exactly like binary orbital motion — see
`../../star-pipeline/pulsation/README.md`. The old `uTime` /
`uSecondsPerDay` uniforms are gone.

## Time scrubber widget

`time-scrubber-widget.ts` is the scrubber — a first-class control living
in the bottom-right `.meta` slot. Collapsed,
`.meta` shows the star count + live UTC readout (the readout is a button
that opens the scrubber); the `T` shortcut and clicking the readout both
toggle it. Opened, it replaces that with a model-time readout + transport
controls + a `datetime-local` jump, and an `×` collapses back. Toggling
open/closed never changes the clock — only **Reset** returns to live-now
at 1×.

While the scrubber is open, `←`/`→` rewind/fast-forward, `Space` toggles
play/pause, and `Backspace` resets. These dispatch from the central
`../../ui/keyboard-shortcuts.ts` (not a second keydown listener) through the
widget's `stepBack` / `stepForward` / `togglePlay` / `reset` — the same
`press(action)` path the buttons use. The dispatcher's `targetIsEditable`
guard leaves the jump date-field's native arrow-key segment editing intact
when it's focused.

The `.meta` slot lives in the right-hand control column's bottom group
(`.ui-top-bottom`), so an expanding scrubber pushes the focus card up
through normal flex layout — see `../../ui/README.md` § Layout containers.

It drives the `VirtualClock`, building its transport row from `time.ts`'s
`TRANSPORT_BUTTONS`. The controls render as monochrome line-art SVG glyphs
(`transportIcon`, `currentColor` stroke) — thin-line iconography matching
the rest of the app rather than platform emoji, all one size so reset reads
as prominently as play/pause. Rate shows as a human "time / second" phrase
(`formatRatePerSecond`, pure + unit-tested). Colours ride the root CSS
tokens so chart mode (`body.monochrome`) adapts; only the translucent
panel background carries an explicit light-mode override in `styles.css`.

The catalogue moves with the scrubbed clock too — star positions
re-advance off their J2016.0 baseline on 1/20-Julian-year bucket
crossings (`../../loaders/README.md` on `epoch-advance-pure.ts`;
SCIENCE.md § Current-epoch star positions) — but this widget stays
clock-only and never touches positions itself.
