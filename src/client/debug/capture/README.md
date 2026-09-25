# Capture — repeatable takes for screen recording

`debug.capture()` flies the camera between two shared views over a stated
number of seconds, with the simulation clock under the take, and holds the
render gate open for the length of it. It exists so a video of the model is
a *take* — re-shoot it after a copy tweak, a palette change or a renderer
change and get the same move back — rather than a mouse flight nobody can
reproduce. The marketing site's sight slots are what it feeds.

## Files in this area

```
src/client/debug/capture/
  capture.ts                  The run: apply the start view, drive pose and
                              clock per frame, restore everything after.
  capture-pure.ts (+ test)    Easing, the pose interpolation, the focal
                              anchoring, the frame compatibility test, the
                              clock plan.
```

## Calling it

```js
await debug.capture({
  start: 'BIWAgwQHh94lwe8XxkHStmPBByyDGb8kt0c-N7BGP8dGp4MDAA',
  end:   'BIWAgwQHzzTNvvcnMj81e9i-B5XuFL_VLxo-xZ5MP8dGp4MDAA',
  seconds: 5,
});
```

| option | default | what it does |
| --- | --- | --- |
| `start` | — | the view the take opens on. A bare blob, a whole share URL on any of the three transports, or a `v=<blob>` fragment. Applied in full — focus, filters, declutter level, pinned `t`, everything the link carries. |
| `end` | `start` | the view it lands on. **Pose only** — `cam`, `tgt`, `up`, `fov`. Every other field in it is ignored, so a take is one state with a camera moving through it. |
| `seconds` | `5` | length of the move. |
| `startTime` | — | simulation time to open at: Unix seconds, or any string the scrubber's jump field takes (`2026-09-17 21:30`, `JD 2451545.0`, `JD 2451545.0 UT`). |
| `endTime` | — | simulation time to land on as the camera lands. Solves the rate. |
| `rate` | `1` | clock rate when no `endTime` solves one. `0` freezes the sky. |
| `ease` | `'smooth'` | quintic, still at both ends, or `'linear'`. |
| `delay` | `0` | seconds holding the start view before the move — room to start the recorder. |
| `hold` | `0` | seconds holding the end view after arriving, so the recording has a tail. |

**Shoot from a shared view, never a hand-typed one.** A blob naming a focus
and no camera has no pose for the take to read, so it opens at the canonical
30 pc rather than at the park pose the same link would restore
(`../../util/url-state/README.md`, the `applyFocusTarget` bullet). Every blob
the app itself produces carries its camera.

The return value is a promise that resolves when the take ends, with a
`cancel()` on it that stops it where it stands. Starting a take cancels any
take already running. One console line goes out at each end of a take — the
length, the two orbit radii and the solved clock rate at the start, and
whether it landed or was cancelled at the finish.

A take opens in **navigate** mode, leaving OBSERVE if the session was in it:
a navigate blob says nothing about the mode, so a session left in OBSERVE
would otherwise stay there and re-pin its look target under every pose the
take writes.

## Both blobs must be anchored on the same object

`cam` and `tgt` are coordinates in the floating local frame, whose origin is
the focused object (`../../frame/README.md`). Two blobs on different focuses
state their poses against different origins, so blending them component-wise
produces a camera path neither link asked for — and it looks like a plausible
move rather than an error, which is why `frameMismatch` refuses the pair up
front and names which field disagrees: focus, `worldOffset`, or an OBSERVE
mode whose pose is an orientation rather than a position and a target.

Travel between two different objects is what warp is for. To shoot one, put
the warp in the take's subject rather than in its camera track.

## The take rides the focal object

A hard focus — star, planet, probe — puts the floating origin *on* the object,
so a blob written under one states `cam` and `tgt` as offsets **from that
object**, not as fixed points of the frame. The take reads the focal's live
local position every frame and writes the pose onto it, which is what holds
the object under `controls.target` and keeps `uPinFocusToCenter` engaged for
the length of a take ([Pin-to-center](../../camera/focus/README.md#pin-to-center-upinfocustocenter)).

The object really does move, and fast: a clock spending a year in five seconds
crosses an epoch re-advance bucket every 0.05 Julian year, and each crossing
steps the focal by its whole space motion over that bucket
([The star frame](../../star-pipeline/star-frame/README.md#the-star-frame)). Close in, that
step is not small against the orbit radius — a take on Mira parked at 1.3 AU
covers about eighteen times its own camera-to-star distance over one pulsation
period, so a pose written as fixed frame coordinates does not drift off the
subject, it loses it inside the first second.

Riding the anchor is also what makes a take survive a **mid-take recentre**.
The focal-anchor policy shifts the origin onto the object as it travels
(`../../frame/README.md`), which renumbers every local coordinate — but an
offset between two of them is unchanged by it. Only the anchor is read in the
current frame, so nothing else the take caches has to be migrated.

Soft focuses (cloud, LG object, boundary shell) don't recentre the origin, so
their coordinates are offsets from nothing and the pose is written as it
stands. Same for a blob that is explicitly unfocused. A blob that names no
focus at all is a Sol take — the start view re-establishes that frame before
the move opens (`../../util/url-state/README.md`).

## The move is an arc at a geometric radius

The orbit vector `cam − tgt` is slerped and its length interpolated
geometrically — equal time per decade of distance — with `tgt` itself lerped
along a straight line and `fov` treated as angular, so it rides the same
geometric rule.

Straight-line interpolation of the camera position is wrong for the takes
this tool is for. Angular size runs as `1/d`
([The angular-arrival problem](../../camera/arrival/README.md#the-angular-arrival-problem)), so a
1.5-decade approach — 30 pc to 0.9 pc, which is one of the homepage's own
sights — spends four fifths of a linear move in a far field where nothing
appears to change, then crosses every visible scale in the last few frames.
Equal time per decade is equal time per octave of apparent size.

The default ease is the quintic smootherstep the arrival profile lands on
([Profile](/src/client/camera/arrival/README.md#profile) there), which has zero velocity *and* zero acceleration at both
ends: the camera is genuinely still on the first and last frames, which is
what makes a loop cut cleanly.

## What the clock does

An `endTime` is a destination and therefore **solves** the rate: the clock
runs at whatever multiple lands on that instant exactly as the camera lands
on the end pose, and is pinned there for the rest of the take. The move
spends time linearly while the camera eases, so the sky's own rate is
constant on screen.

With no `endTime`, `rate` runs for the whole take — `0` for a frozen sky,
`86400` for a day a second. `startTime` is a jump either way, and the take
owes `Stellata.notifyClockJumped()` for it like any other transport
(`../../solar-system/time/README.md`).

`t` is clamped to 3000 BC – 3000 AD, so an `endTime` outside that window
pins at the bound partway through the move and the clock stands still for
the rest of it.

### A fast clock slows short variables down

Variable pulsation carries an anti-strobe floor: no cycle is allowed to
complete in under `uMinPeriodSec` (4 s) of real time, so above
`period / 4 s` the star pulsates at the floor rather than at its own period
(`../../webgpu/star/star-vertex-tsl.ts`). A take shooting a variable has to
stay under that, and it is the take's rate that decides — Mira's 332 days in
5 seconds runs at 64 model-days a second, whose floor is 256 days, just
inside its period. Ask for the same span in 4 seconds and the floor is 320
days: the star would visibly pulsate slower than the clock says. Divide the
period by 4 seconds for the fastest model-days-per-second a subject takes.

## What a take holds for its duration

- **A render-gate hold**, so every rAF tick draws rather than the gate
  idling a still camera or a paused clock (`../../render-gate/README.md`).
- **`controls.enabled = false`**, so a stray pointer or wheel event during a
  recording cannot deflect the move. `TrackballControls.update()` keeps
  running — that flag gates its listeners, not its per-frame work, which is
  what still rebuilds the camera from the position and target written each
  frame.
- **The `'frame'` subscription** the pose is written from — [Writing the pose
  from `frame`](#writing-the-pose-from-frame-which-is-a-departure), which is a departure.

Every one of them is released on completion and on `cancel()`, including the
camera mode's own `enabled` value as it stood before the take.

**What a take does not put back is the sky.** The clock rate, the pinned `t`
and the FOV are left where the take landed them, and the camera with them: a
take ends on its end view, which is the whole point of shooting one. So a take
is not a probe — run it when the session is free to be moved, and re-apply a
share link to get a known state back.

The first two frames after the start view is applied are spent holding that
pose, so a focus carried by a SID whose domain attaches late has landed
before the move opens — until it does there is no focal anchor to ride and
the pose writes as bare frame coordinates.

## Writing the pose from `frame`, which is a departure

`../../util/event-bus/README.md` rules the `'frame'` event out for camera
writes, and names the scene registry as the seam that can order one — the orbit
lock is the worked example. A take writes the camera from `'frame'` anyway, so
the reason has to be on the record rather than inferred from the code.

The rule's harm is that a write landing after the draw shows up a frame late,
and that anything the frame drew from the camera — an instrument's own readout
— disagrees with it in between. A take has no readout, and the lag is a
constant: `TrackballControls.update()` rebuilds the camera from the written
position and target at the top of the next tick, ahead of the whole layer
fan-out, so every layer in a recorded frame agrees with the camera that frame
was drawn with. The take is one interpolation step behind wall time and nothing
else is behind the take.

What would change that is a second writer. A take that has to interleave with
per-frame camera work owned elsewhere wants a sequencing registry entry, at
which point this section is the thing to delete.

## Pacing

A take runs on wall-clock time through `performance.now()`, so it is exactly
as smooth as the browser's own frame delivery — a dropped frame is a dropped
frame in the recording. Recording a long take on an otherwise-quiet machine
is what buys a clean one.
