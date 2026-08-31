# ORB — the focused object's own orbital plane

The one reference frame that is a property of what you are looking at rather
than of the sky. This README is the authority on ORB; `../README.md` keeps the
instrument that displays it, and `captureOrbitFrame` stays there in
`../attitude-pure.ts` beside the other frame builders.

## Files

```
orbit-plane.ts (+ test)  The focused object's own orbit — plane normal and
                         the direction to the orbit's centre — dispatched to
                         whichever subsystem holds it. Split in two:
                         `resolveFocusedOrbit` once per focus,
                         `focusedOrbitFrom` per rendered frame
                         (§ What each frame re-reads, and what it must not).
```

Nothing here imports from the parent folder: the dispatch reaches the
solar-system and binary subsystems directly, and the frame it feeds is built
one level up.

## Capturing it

Double-click the ball and the active frame becomes **ORB**,
whose pole is the normal of the orbit the focused object *itself* rides. It
is planted from `orbit-plane.ts`'s answer rather than from the current
attitude, and `level()` then runs unchanged. Unlike REF it is **live** —
§ Orbit rate.

The frame flag reaches the same frame without the levelling
(`../README.md` § Which frame, and who chooses). Both routes capture through
`captureOrbitFrame`, so the two never disagree about what ORB means — they
differ only in whether the camera moves afterwards.

**Zero longitude points at the centre of the orbit** — the host star, the
parent body, or the pair's barycentre — which is the same point each
subsystem anchors the drawn orbit ring on. That is the one difference from
REF, whose datum is the boresight: ORB's is a property of the orbit, so the
same object levelled from anywhere reads the same longitude. It is a direction,
not a distance, so the focus-versus-geometric-centre distinction the ellipse
carries does not arise. The centre direction already lies in the orbital
plane, leaving the boresight to seed a degenerate case that a real orbit
does not produce.

## Orbit rate

**ORB is rebuilt every rendered frame, not captured** — it is the one frame
on the instrument that is not a snapshot. Zero longitude keeps pointing at the
orbit's centre as the object travels, so the grid turns beneath the boresight
at the orbital rate. That is the mode the real FDAI ran in on orbit, and it is
what makes the instrument read as *riding* an orbit rather than as having been
told about one: Luna walks ~13° per day of model time, and a fast scrub sweeps
the ball round with it instead of leaving the datum behind.

**What that costs, stated plainly:** the focused object now sits at zero
longitude by construction, so the ball no longer measures how far it has
travelled since you asked. The reading it gives instead is attitude against a
frame that travels with the object, which is the one the mode exists for. The
pole is unaffected either way — it is a static function of the elements.

Two consequences anything touching this has to honour:

- **A still camera is not a still instrument.** The mini renderer redraws when
  the DATUM moved as well as when `camera.quaternion` did — but on that test,
  not on "a live frame is up": a paused clock rebuilds ORB to the same vector
  and there is nothing to repaint. Nothing runs while the render gate idles
  either: if no frame is drawn, the orbit has not advanced.
- **The per-frame path evaluates ONE body's orbit, and the frame it writes
  into is preallocated.** `orbitFrameInto` writes a `ReferenceFrame` the
  instrument holds for the life of the page; `captureOrbitFrame` is the
  allocating wrapper, kept for callers that want a frame of their own. The
  dispatch reaches `PlanetBodyField.orbitPlaneNormalOf`, which goes through
  `PlanetSystem.orbitGeometryOfAt` — **never `orbitGeometryAt`**, whose array
  form runs the lunar theory and 17 Kepler solves for Sol and discards 26 of
  the 27 rows. Doing that per frame reinstates exactly the cost the ring
  layer's visibility gate exists to skip
  (`../../solar-system/ephemerides/README.md` § Orbit rings).

## What each frame re-reads, and what it must not

ORB is rebuilt per rendered frame, so the split between what moves and what
does not is a per-frame cost rather than bookkeeping. `resolveFocusedOrbit`
runs once per focus and `focusedOrbitFrom` runs per frame:

- **A pair's plane normal is resolved once and held.** An orbit is planar and
  the elements are frozen, and the vantage the sky-frame normal projects
  through comes from `catalog.positions`, which the clock does not move — so
  the answer cannot change while the focus stands. Per frame only the
  direction to the partner is re-read, straight out of `localPositions`. What
  this replaced re-derived the normal every frame: `innermostRelationOf`,
  `keplerRelationParams`, `orbitNormalSky` and `projectSkyToICRS`, allocating
  a handful of short-lived objects each time, to reproduce a constant.
- **A planet's normal is NOT held**, and that asymmetry is real rather than an
  oversight: Triton's node precesses, so a moon's plane is genuinely a
  function of `t` (`../../solar-system/ephemerides/README.md` § Every other
  moon). The source carries only the body index and `t` reaches the field
  every frame.
- **The source is re-asked while it is null.** Both the binaries artifact and
  the planet kind attach after a focus can be set, so a resolve that failed
  has to be retried rather than cached as "no orbit" for the life of the
  focus.

## The lock

The chip under the frame flag — a padlock, shown only while ORB is what the
ball is reading — **rides the orbit**: it holds the attitude the instrument is
showing as the datum turns beneath it, so the camera swings round with the
object and the ball stands still while the world moves under it. Off by
default, and it leaves with the frame, since every other frame's datum is
fixed and there would be nothing to ride.

`ridePoseAbout` is the whole motion, and **one axis-angle does both halves**:
ORB's pole is static, so only zero longitude travels, and the swing about the
pivot and the roll are the same rotation about the orbit normal. The angle is
the signed turn from the datum's last position to its current one, read about
that pole.

**This is a camera writer on the steady-state navigate path**, which
`../../camera/controls/input/README.md` § Orbit drift otherwise forbids —
that rule exists because a per-frame write with no fixed point 2-cycles
between adjacent doubles and the render gate can then never idle. The lock is
admissible for the reason a gesture is: **it writes only on a frame where the
datum moved far enough for the write to show.**

**"Actually moved" is not the test, and cannot be.** The ride writes the camera
*below* the gate, so the next tick reads any write at all as a fresh camera
move and renders — the § The focal ride loop in
`../../render-gate/README.md`, which a rotation has no rebase to escape
through. A paused clock does turn the datum by exactly zero and the gate idles
as before, but that covers only the paused case: at live 1× Luna's datum turns
~2.6 × 10⁻⁶ ° per 60 Hz tick, a genuinely non-zero turn some 2700× under
anything a display can show, and writing it every tick pins the gate at 60 fps
for a picture that never changes.

`orbitRideTurn` therefore rides only past **`cadenceVisibleTurnRad`** — the
cadence's own 0.25-device-pixel scheduling step converted to a camera turn
(0.0069° at the pinned vantage), so the lock schedules against the same
threshold every other driver does. Under a threshold it returns zero and **the
datum is left where it was last ridden from**, which is what accumulates those
turns into one ride carrying the whole angle; advancing it per frame would drop
each one and the lock would slowly slip its grip. Faster than live the gate
never idles anyway, so a scrub crosses the threshold every frame and rides
exactly as before.

Three ordering details that are easy to get wrong, and one of them shipped
wrong once:

- **The ride is not part of the instrument's draw path.** It moves the CAMERA,
  not the instrument, so it runs on every rendered frame including the ones
  the instrument is hidden for — `U`, a collapsed panel, any off-screen check.
  Hanging it off the drawing path made hiding the UI silently disengage the
  lock and then replay the whole accumulated turn as one swing when it came
  back.
- **The datum's last position is recorded whether or not the ride ran.** A
  frame skipped because a warp or an observe transition owned the camera must
  not replay as one enormous swing when the transition ends.
- **Engaging the lock seeds from wherever the datum is now**, not from where
  it was when ORB was armed, for the same reason.

Navigate only, and the lock clears on entering observe: the ride orbits the
camera about `controls.target`, which is not what observe's camera does — it
sits on the object rather than circling it.

Rebuilding rather than only rolling is what makes the gesture legible: rolling
to a plane the instrument is not displaying leaves the caret reading un-level
against the *old* frame, so the gesture would look like it had failed.

**Always the innermost orbit the object is on.** Luna levels on its orbit
about Earth, not Earth's about Sol; Algol Aa2 on its tight inner pair, not
on the wide Aa-Ab one its primary also belongs to. Each subsystem answers
from its own elements — `PlanetBodyField.orbitPlaneNormalOf` /
`orbitCentreOffsetInto` for a body (`../../solar-system/ephemerides/README.md`
§ Orbit rings), `starOrbitNormalIcrs` plus the returned pair's other member
for a pair (`../../binaries/README.md` § Which pair a star rides).

**Whatever plane that orbit is drawn in is the plane ORB captures** — a
published inclination where there is one, the galactic-plane fallback where
there is not. The rule is "level me on the orbit you are showing me", and
it holds for every orbit the model draws. Anything narrower makes the
affordance appear and disappear on a property of the *source data* that
nothing on screen exposes, which is the same ring either way; a user who
finds ORB on one companion and not its neighbour has been shown no reason
why. Dabih is the case: β Cap's Ab and Ab2 sit in a spectroscopic sub-pair
whose tilt was never published, and they level on it like anything else.

**The obvious shortcut is wrong and must stay unused here.**
`orbitalPlaneNormalFor()` answers per HOST STAR — the ecliptic for Sol,
galactic otherwise — so routing a body through it would level every
solar-system object on the ecliptic and every moon on the wrong plane, while
looking exactly like a working feature.

Two silent no-ops, and both are absences the user can see, because in each
case nothing is drawn to level on: a **Tier-3 pair**, which carries no
orbital elements at all, so no orbit is evaluated and no ring appears; and a
**host with no live element source** (its rings fall back to
`defaultOrbitGeometry`, flat on the host plane). Kinds that ride no orbit at
all — probes, clouds, shells — are the third, and the ordinary one. Where
there is no ring, there is no ORB.

The normal is a static function of the elements, not a sampled one: an orbit
is planar, so `r(t) × r(t+dt)` recovers only what `Rz(Ω)·Rx(I)·Rz(ω)` and the
Thiele-Innes basis already state exactly, and it degenerates whenever the two
samples come back near-parallel.

Retrograde orbits keep their sense. Triton's normal points south of the
ecliptic and levelling on it inverts the view, because that is where its
angular momentum points.
