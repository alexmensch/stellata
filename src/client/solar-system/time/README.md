# Simulation time

Simulation time `t`, the `VirtualClock` behind `Stellata.getT()`, the
UT readout, and the transport scrubber widget. This folder is the
**single source of truth for wall-clock sampling** — nothing else in the
codebase reads `Date.now()` for the model clock.

## Files in this area

```
src/client/solar-system/time/
  delta-t-pure.ts (+ test)        ΔT = TT − UT, Espenak & Meeus, -1999 to
                                  +3000. See § Timescales.
  time.ts (+ test)                Simulation time `t` + the UT ↔ Julian-day
                                  and TDB helpers (§ Timescales). Owns
                                  VirtualClock, the clock behind
                                  Stellata.getT(), plus the FF/RW rate
                                  transitions, rate label, and the
                                  TRANSPORT_BUTTONS action spec. Single
                                  source of truth for the scrubber.
  time-readout.ts (+ test)        Two-line time readout next to the time
                                  scrubber: UT date + JD(TT)/ΔT.
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

**The two transports that move `t` discontinuously — Jump and Reset —
owe `Stellata.notifyClockJumped()`.** They write the `VirtualClock`
directly rather than through `setT`, which would force rate 0 and so
lose a jump made while playing; the epilogue is what reseeds every
kind's t-sampled state at the new instant and repaints a jump made with
the clock paused (`../../render-gate/README.md`). Both reach it through
the widget's single `afterClockJump`, so the debt is paid structurally
rather than remembered at each call site. A rate change is not a jump —
FF/RW/play/pause snapshot `t` and need nothing.

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

`t` runs in **UT** — the model's day count is a uniform 86400 s with no
leap seconds, which is UT, not UTC (UTC did not exist before 1972) —
and `tToJdUt` / `jdUtToT` are the exact inverse pair
that carry it to and from a Julian Date in that same scale. Everything
whose epoch argument is a wall-clock instant — the readout, the scrubber,
the star-catalogue epoch advance, binary orbits — reads that pair.

**The ephemerides do not.** JPL's element tables and the Standish series
are both defined against **TDB**, which runs ahead of universal time by
ΔT. `tToJdTdb` / `jdTdbToT` add and remove it, and `../ephemerides/`
reads through them exclusively — planets and moons alike. Feeding a
UT-scale JD to the element evaluation instead moves Mercury by 2.2e-5 AU,
which was the dominant term left once the element tables landed.

**ΔT is not a constant, and at this clock's range it is not small.**
`delta-t-pure.ts` is the Espenak & Meeus polynomial set (−1999 to +3000),
thirteen fitted intervals with the Morrison & Stephenson long-term
parabola carrying each tail, plus NASA's lunar-secular-acceleration
correction −0.000012932·(y−1955)² s: the polynomials assume the Moon's
secular acceleration is −26″/cy², the eclipse canons and the ELP/DE
lunar ephemerides the model is pinned against use −25.858, and without
the reconciling term ΔT reads 202 s high at 2000 BC. It is 69 s today
and **20.6 hours at 3000 BC** — 310° of Earth rotation. A fixed offset
put every ancient eclipse track most of a hemisphere from where it
belongs.

The split that makes eclipses work is therefore:

| quantity | scale | why |
|---|---|---|
| the clock `t`, the readout, star epochs, binaries | UT | what a user means by a date, and what historical records give |
| planet + moon ephemerides | TT = UT + ΔT | the element sources are defined there |
| every body's spin except Earth's | TT | uniform rotators, the IAU convention's own argument |
| **Earth's spin** | **UT** | ΔT *is* Earth's rotational lag — see `../planets/rotation/README.md` § Earth is not a linear row |

`jdTdbToT` is a fixed-point iteration rather than a subtraction, because
ΔT depends on the epoch being solved for. It converges immediately: ΔT
changes by under 1e-6 of itself across one ΔT.

**Known departure.** Espenak's 2005–2050 segment was extrapolated in
2006 and Earth's rotation did not slow as projected, so it reads ~75 s in
2026 against an observed ~69 s. Using it uniformly rather than splicing
in the exact leap-second constant keeps the function continuous; the 6 s
costs 6 km of Moon and 1.9e-6 AU of Mercury, both under the bounds those
chains already hold (12 km and 1e-5 AU respectively).

Jump-to-date is a plain **text** input whose value is read as **local**
time (`toLocalDatetimeValue` / `parseLocalDatetimeValue` in `time.ts`),
even though the readout displays UT — deliberate, so it matches the
operator's wall clock. Format is `LOCAL_DATETIME_FORMAT`
(`YYYY-MM-DD HH:MM:SS`, 24-hour, seconds optional, `T` accepted as the
separator); the placeholder is `JUMP_FIELD_PLACEHOLDER`, that format plus
the JD escape below. Reset already
snaps to live-now at 1×, so there is intentionally no separate "now" jump.

The field's second form is a bare **Julian Date**
(`parseJulianDateValue`): `991085.635`, `JD 2451545.0 UT`. It exists
because astronomically-pinned events are published as a JD, and retyping
one as a calendar date means doing the ΔT arithmetic by hand — the
arithmetic the readout's JD line exists to remove. The scale defaults to
**TT** (what catalogues publish, and what the readout shows, so a canon
value round-trips verbatim); a `UT` suffix overrides — the two are ΔT
apart, 13 hours at 2000 BC. An unprefixed integer needs ≥ 6 digits
(every JD the clock can reach has six or seven), so a lone typed year is
rejected rather than read as a deep-past JD; a decimal point or the `JD`
prefix marks the intent explicitly. No collision with the datetime form:
its dashes disqualify it as a number, and a digits-only partial datetime
was never acted on mid-typing anyway (validation fires on Jump or blur).
An out-of-window JD clamps-and-echoes exactly like the datetime path,
and the echo is always the canonical **local datetime** — one canonical
echo rather than per-entry-form state, with the readout's JD line as the
JD-scale confirmation of where the clock landed.

**Typed-only, and `datetime-local` cannot deliver that.** It was one
originally, with
`.scrubber-jump input::-webkit-calendar-picker-indicator { display: none }`
suppressing the picker. That hides the *dropdown button*, which in Blink
is the only way to open the popup — so Chrome and Edge behaved. WebKit
opens its native popover from the segmented fields themselves, so Safari
ignored the rule entirely and there is no pure-CSS way to keep those
segments editable while suppressing it. A text field is typed-only on
every browser by construction, and it is what makes the clock's own
3000 BC – 3000 AD range reachable at all: `datetime-local` never accepted
a negative year.

The trade the native control was carrying — the format-error trap of a
raw text box — is answered by validation instead. `parseLocalDatetimeValue`
is **strict**: an anchored regex plus a component build, not
`new Date(value)`. The lenient constructor accepts far more than this
field means *and silently changes scale doing it* — `new Date('2030')` is
a valid **UTC** instant, so a half-typed year would have jumped the clock
somewhere other than where the same digits land once complete.

**Every field may be typed unpadded** — `78-4-1 1:20` is `0078-04-01
01:20:00` — and seconds may be dropped. Padding is what the encoder emits,
not what the parser demands: the field is typed by hand and the flag only
fires on Jump or blur, so a partial entry is never acted on mid-typing, and
a jump that lands echoes the canonical padded form back where a mis-parse
is visible. The year caps at 4 digits so a mistyped one cannot run on, and
a 2-digit year is **that** year — never windowed into the 1900s. Windowing
would put years 0–99 out of reach by their own digits, which is why the
parser calls `setFullYear` to undo the `Date` constructor's 1900+ shorthand
in the first place.

Only the *time* fields carry an explicit range check: an out-of-range month
or day moves the date, which the rolled-over-date comparison catches, but an
out-of-range minute or second can roll forward inside the same day, where
it would not.

A rejected entry flags the field (`.is-invalid`, `aria-invalid`) and
no-ops the jump; the flag is set on Jump or on blur, never per keystroke,
so a half-typed date is not marked as an error. An **empty** field is
absent rather than malformed and is never flagged. Enter jumps and then
blurs the field — but only when the entry parsed, so a rejected one keeps
focus to be corrected.

A jump that lands writes the **clamped target** back into the field, not a
re-read of the clock. The two differ: `notifyClockJumped()` reseeds every
kind before the read would happen, and at a high rate that elapsed
wall-clock is a visible slice of model time (at 86400× a millisecond of it
is a minute and a half). `clampT` is exported for exactly this, so the
widget never re-derives the window bounds.

`time-readout.ts` renders the live timestamp the rendered positions
correspond to. It mounts the collapsed `.meta` readout (`#time-readout`, a
button that opens the scrubber); while the scrubber is expanded, that
readout is hidden and the scrubber's own readout takes over. Either way the
current model time stays on screen in every mode (free fly, chart, warp,
observe) — binary orbital evolution ticks against `getT()` throughout, so
the user always benefits from knowing which moment is being rendered.

Two lines, in every era (`\n`-joined; `white-space: pre-line` on
`.time-readout` renders the break):

```
25 May -1999, 14:20:26 UT (Gregorian)
JD 991085.635000 TT · ΔT +12h 54m
```

Line 1 is plain-English UT, locale-independent — month abbreviations are
hard-coded en-US to avoid DD/MM vs MM/DD ambiguity across browsers. Both
suffixes are load-bearing. **The calendar stays proleptic Gregorian in
every era, and says so**: eclipse canons and ancient observation records
label pre-1582 dates in the **Julian** calendar (18 days apart at
2000 BC — half a lunation, so a canon date typed into the jump field put
the Moon nowhere near the Sun), but the Gregorian label is the one that
tracks the seasons; the Julian/TT string is a catalogue lookup key, not
a truer date. Deliberately NOT Stellarium's switch-at-1582 behaviour.
The ` (Gregorian)` suffix shows only on the collapsed readout
(`showCalendar` in `formatTimeReadout`) — the expanded scrubber header
has no room for it.

Line 2 is the reconciliation: the JD in **TT**, the scale every canon
publishes against, so a catalogue's number is directly matchable — plus
ΔT. The two
lines legitimately name different calendar days (the JD is ΔT later);
that is the point, not a defect. Six JD decimals (0.086 s) so the lines
agree at the seconds resolution displayed. No tooltip explains ΔT —
Stellata deliberately carries no tooltips.

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
`.meta` shows the star count + live UT readout (the readout is a button
that opens the scrubber); the `T` shortcut and clicking the readout both
toggle it. Opened, it replaces that with a model-time readout + transport
controls + a typed jump-to-date field, and an `×` collapses back. Toggling
open/closed never changes the clock — only **Reset** returns to live-now
at 1×.

While the scrubber is open, `←`/`→` rewind/fast-forward, `Space` toggles
play/pause, and `Backspace` resets. These dispatch from the central
`../../ui/keyboard-shortcuts.ts` (not a second keydown listener) through the
widget's `stepBack` / `stepForward` / `togglePlay` / `reset` — the same
`press(action)` path the buttons use. The dispatcher's `targetIsEditable`
guard suppresses those transport actions while the jump field has focus,
so `←`/`→` move the caret and `Space` types a space.

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
