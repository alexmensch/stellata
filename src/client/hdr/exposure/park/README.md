# Parking the measurement — when the statistic may stop being taken

The state machine deciding when the adaptation measurement's GPU work may
stop, and how it wakes. `../README.md` § Adaptation owns what the
measurement then does; `../reduction/README.md` owns the chain this parks.

```
src/client/hdr/exposure/park/
  adaptation-park-pure.ts   The machine: the parkable predicate, the
    (+ test)                landing streak, the probe interval, and the
                            hold's collapse.
```

`ADAPT_SLEW_SETTLE_MAG` and `AdaptationRegime` stay in
`../scene-adaptation-pure.ts` — they are the branch layer's own, and it
remains the authority on both.

## The question is not "is the cut zero"

**It is "is the cut the measurement's".** A frame whose cut is set by
something the frame does not contain gets nothing from measuring it. Two
states answer that, and `parkable` is the predicate over both. After
`ADAPT_PARK_SETTLED_LANDINGS` consecutive landed measurements meeting it,
with the applied cut settled where it says, the reduction's draws and the
statistic attachment's emitter writes both stop. What stays: the
attachment's **clear** (it must read zero, not stale) and the **readback
fence** — the 1-texel readback is the frame's only ANGLE submission
barrier, which chart mode may drop and scene mode must not
(`../reduction/README.md` § Where it runs). The machine ticks from
`measure()` once per **rendered** frame.

- **No cut.** The measurement is most expensive exactly here — the
  reduction row read 18–26 % of frame at three vantages whose measured
  `dm` was 0, and ~zero where a bright body fills the screen.
- **The display floor governs.** `floor` reads `uWhitePoint` and the
  adaptation anchor and nothing from the frame, so where it wins the
  applied cut is a **constant**. This is the app's own default view: 5 AU
  from Sol (`../../../solar-system/first-load.ts`), `L̄` = 68.6 against a
  white point of 20, coverage 0, `dm` = −6.29 pinned at the floor — and
  the statistic that produced it measured 50.6 % of the frame and was then
  discarded by the `max()` (`../../../debug/frame-cost/README.md`).

**Why parking the floor regime is exact rather than approximate.** `eye >
floor` iff `L̄ < Lw`, so the floor wins precisely where the frame mean sits
at or above the operator's white point — and it is computed from `Lw` and
the anchor alone. While it wins, the applied cut has no input the frame can
move, so sustaining it needs no measurement: there is no drift to bound and
no margin to carry. What ends the regime is the scene changing, in one of
two ways — `L̄` falling under `Lw`, or coverage rising far enough that the
pin starts to weigh — and § Wake below is what bounds how long either takes
to be seen.

**The park never reads a partial measurement**, which is what keeps that
argument this short. A parked frame runs no reduction and lands nothing,
and a probe opens the writes for its own frame *before* the chain runs, so
every landing the machine ever sees is a full-frame one. The lower-bound
argument — glow additive-blended, disc per-channel max, both monotone
non-decreasing in what is drawn, so a partial `L̄` already at or above `Lw`
proves the full one is too — belongs to `stellata-8cg.34`, which keeps
measuring *while* it closes the 313k field draw. It is not load-bearing
here, and reading it as this park's justification gets the implication
backwards: lowering `L̄` is the direction that would take the frame *out*
of the regime.

The pin is untouched by the same argument for a different reason: `D` and
the coverage it divides by are both mask-gated, and **nothing that draws a
kernel or a diffuse column writes a mask** (`../../attachments/README.md`
§ The unit). So a parked frame cannot hide a rising coverage in the star
field — only a real measurement sees the pin take over, which is what the
probe is for.

**The landing struct is caller-owned and reused.** `SceneAdaptation` holds
one `ParkLanding` and refills its five fields every rendered frame rather
than building a fresh one, so the machine costs no allocation on the render
path. `parkTick` may therefore read the landing but must never retain it —
the `ParkState` it returns has to stand on its own.

**One read gates both halves.** `animate()` reads `isMeasurementParked()`
once and hands it to `HdrPipeline.setStatisticWritesParked` before `bind()`
and to `reduction.measure`'s `parked` argument after the resolve. Two reads
could pay the writes with nothing reducing them, or run the chain over an
attachment nothing wrote.

## Two things "settled" has to mean

**"No cut" is the slew's settle band, not exact zero.** `dm` is a GPU
readback, and `slewDm` hands a cut inside `ADAPT_SLEW_SETTLE_MAG` back as
the applied one — so an exact test would refuse to park at any vantage
whose cut lands in that band, keeping the measurement at full cost for a
cut the render gate will not even repaint for. Borrowed rather than
re-picked, and legitimate because the question is numerical: parking
inside it freezes a cut the subsystem already calls settled. The gate
asks a perceptual one and must not borrow it
(`../../../render-gate/README.md`).

**"Settled" is the DIFFERENCE between the measurement and the applied cut**,
not each of them against zero. A floor-governed cut settles at −6.29 rather
than at 0, so "both read no cut" cannot express it; the difference test is
equivalent in the no-cut case, where `slewDm` has already collapsed the
applied cut to exactly 0. That is also what makes the handover stepless
without any hysteresis: parking returns `slewDm`'s own fixed point, so the
parked and unparked cut are the **same number**, not merely close.

## Wake

Once `ADAPT_PARK_PROBE_INTERVAL_FRAMES` rendered frames have passed **and**
the reduction has no readback in flight, a probe opens — writes open, chain
runs — and stays open until its own readback lands; a landing whose cut the
measurement *does* set unparks immediately. From the floor regime that is a
landing where `L̄` has fallen under `Lw` (the eye branch clears the floor) or
where coverage has risen off zero (the pin starts to weigh); from no-cut it
is any cut past the settle band, and the slew ramps from 0. Rendered frames
rather than rAF ticks is load-bearing twice over: the render gate skips
ticks at a static view, so a parked static frame never pays a probe, and the
duty cycle runs exactly while the camera moves through no-cut space — which
is where the win is.

- **A probe frame must open the writes for its own frame.** Reducing the
  cleared attachment costs ~3x reducing live content (~45 ms at 6.774 Mpx,
  vantage-independent), so a measure-over-zeros cadence would be the most
  expensive schedule available — and would measure nothing.
- **Which is why the probe waits for a drawable frame.** `measure()` does
  no GPU work while a readback is in flight, and the parked fence keeps one
  in flight ~3 frames in 4 — so firing on the interval alone opened the
  writes for frames the chain then sat out.
- **`setHeld` outranks the park**, as it outranks chart: the machine
  freezes under a hold, and a hold landing mid-probe collapses it to
  parked, so a frame-cost sweep prices one state rather than whichever the
  pin happened to land on (`../../../debug/frame-cost/README.md`).
- **Chart's reset clears the park** with the rest of the statistic state.
  Warp needs nothing of its own: a parked warp probes on the interval and
  the unpark snaps, as any warp-frame measurement does.

**The wake latency is counted in frames, so it stretches with the frame's
own cost** — ~160 ms at 60 fps, ~1 s at 10 fps, and frames slow as the
camera approaches the bright body that needs the cut, so the bound is
loosest where it is worst. Deliberate for now: a late wake reads as a
moment of over-brightness entering a bright scene, which is what light
adaptation does anyway. `stellata-8cg.23.2` replaces the constant — a
CPU-side brightness ceiling bounds the deepest cut that could be pending,
which is what should set how long the probe may wait.

## What the park does NOT save

The floor-regime park stops the whole measurement periodically and must
keep probing to notice the scene changing, so its steady-state saving is
roughly 60 % of the parked-frame figure rather than all of it
(`../../../debug/frame-cost/README.md` § These rows price the fully parked
frame). Taking the remainder needs the measurement to stay *live* for the
few emitters that supply the frame mean while the 313k-instance field draw
stops writing at all — `stellata-8cg.34`, which is a different mechanism
and not a tuning of this one.
