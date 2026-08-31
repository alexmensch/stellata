# ORB — the focused object's own orbital plane

The one reference frame that is a property of what you are looking at rather
than of the sky. This README is the authority on ORB; `../README.md` keeps the
instrument that displays it, and `captureOrbitFrame` stays there in
`../attitude-pure.ts` beside the other frame builders.

## Files

```
orbit-plane.ts (+ test)  The focused object's own orbit — plane normal and
                         the direction to the orbit's centre — dispatched to
                         whichever subsystem holds it.
```

Nothing here imports from the parent folder: the dispatch reaches the
solar-system and binary subsystems directly, and the frame it feeds is built
one level up.

## Capturing it

Double-click the ball (or `Shift`+`L`) and the active frame becomes **ORB**,
whose pole is the normal of the orbit the focused object *itself* rides. It
is a captured datum like REF, planted from `orbit-plane.ts`'s answer rather
than from the current attitude, and `level()` then runs unchanged.

The frame flag reaches the same frame without the levelling
(`../README.md` § Which frame, and who chooses). Both routes capture through
`captureOrbitFrame`, so the two never disagree about what ORB means — they
differ only in whether the camera moves afterwards.

**Zero longitude points at the centre of the orbit** — the host star, the
parent body, or the pair's barycentre — which is the same point each
subsystem anchors the drawn orbit ring on. That is the one difference from
REF, whose datum is the boresight: ORB's is a property of the orbit, so the
same object levelled from anywhere reads the same longitude, and the ball's
longitude reads where the object sits on its own orbit. It is a direction,
not a distance, so the focus-versus-geometric-centre distinction the ellipse
carries does not arise. The centre direction already lies in the orbital
plane, leaving the boresight to seed a degenerate case that a real orbit
does not produce.

**Vantage-invariant, not epoch-invariant** — a captured datum is a
snapshot, as REF's is. The pole is a static function of the elements and
barely moves, but zero longitude is the centre direction at the instant of
capture, and the object keeps going round: Luna walks ~13° off its datum
per day of model time, and one frame of fast scrub can carry it anywhere on
the orbit. Double-click again to re-read. Do not "fix" this by recomputing
the frame per tick — a datum that chases the object reads a constant
longitude and stops measuring anything.

Capturing rather than only rolling is what makes it legible: rolling to a
plane the instrument is not displaying leaves the caret reading un-level
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
