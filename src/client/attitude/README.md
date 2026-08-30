# Attitude indicator — spike

**Throwaway.** A branch-only experiment in giving the camera an attitude
indicator so the viewer always knows which way is "up" relative to a chosen
reference plane. A gyro-sphere — the old gimballed 8-ball, rendered as a real
sphere — not a flat two-tone horizon. Delete the folder and its three wiring
lines (`index.html`, `main.ts`, `styles.css`) and nothing else changes.

## Files

```
attitude-pure.ts (+ test)  Frame table (equatorial / ecliptic / galactic), the
                           camera→(pitch, bank, longitude) read, and the ball's
                           model matrix.
attitude-ball.ts           The painted grid texture and the standalone mini
                           renderer that draws the sphere.
attitude-indicator.ts      The instrument: canvas + fixed SVG chrome, bottom
                           left, plus click-to-level and the frame chip.
```

## What it reads

The scene basis **is** ICRS with x at α 0h and z at the north celestial pole
(`../galactic/coord-spheres/README.md`), so a frame is fully described by its
pole plus a zero-longitude direction, and the instrument needs nothing but
`camera.quaternion`:

- **pitch** — elevation of the boresight above the frame's reference plane.
  In the equatorial frame this is literally the declination of screen centre.
- **longitude** — the boresight's azimuth in that plane: right ascension for
  the equatorial frame, ecliptic longitude λ, galactic l.
- **bank** — the signed roll from level, about the view axis. Positive means
  the frame's north lies clockwise of screen-up, which is a **left** bank in
  aircraft convention, so the readout negates it.

Near the pole the level up shrinks to nothing and the bank stops being a
measurement. **Two cones, and they are not the same number.** Inside
`POLE_HOLD_DEG` (1°) the read declines to write bank at all and the last one
stands, so crossing the pole doesn't spin the ball on float noise; the
*readout* warns from 15° out, matching the `POLE_CONE_DEG` the roll correction
itself eases off inside (`../camera/controls/input/reference-up-pure.ts`).
Between the two the ball still tracks, and it is genuinely twitchy there —
that twitch is the honest reading.

## The ball's matrix is a reflection, and that is the whole trick

`ballBasisInto` builds a matrix with **determinant −1**. A direction lands on
the instrument exactly where it lands on screen in the real view, so the ball's
grid is a true miniature of the coordinate sphere the scene draws — turn on the
matching grid with `S` and the lines agree — with the boresight at the centre.

A pure rotation cannot do both. A globe read from *outside* is the mirror of a
sky read from *inside*, so an orientation that puts the boresight at the centre
of a globe necessarily flips left and right. Real celestial globes carry that
same mirror; a terrestrial globe and a celestial one run their longitudes in
opposite senses for exactly this reason.

Two consequences anything touching the ball has to honour:

- **The texture is drawn mirrored in longitude.** Every glyph goes through
  `mirroredText`; grid lines are symmetric and need nothing. Skip that and the
  numerals read back-to-front.
- **The material is unlit.** A lit one would shade the far side, because the
  reflection turns the surface normals inward. The sphere's volume is faked by
  an SVG rim-shade and gloss painted over the canvas instead.

The dynamics come out right in all three axes regardless, and the tests pin
each one: pitching up drives the old centre *down* the ball, yawing right
drives it *left*, banking right tips the pole *left* by the bank angle.

## Rendering

`attitude-ball.ts` owns a **second `THREE.WebGLRenderer`** on its own small
canvas — deliberately not a viewport pass on the main one, whose every draw
lands in the HDR target and would take scene exposure and tone-mapping with it
(`../hdr/README.md`). A separate context is the cheap way to keep instrument
chrome out of the physical light path.

It redraws only on ticks where `camera.quaternion` actually changed, so a
static view costs nothing. The grid texture is rebuilt only when the frame
chip changes, since only its labels differ.

## Levelling

Clicking the ball zeroes the **roll** only — the boresight does not move. That
is deliberate: in NAVIGATE the camera orbits a target, so pitching to the
horizon would move the camera through space, not just turn it.

The two modes need different calls, matching the split in
`../camera/controls/input/README.md` § Snap-to-level: NAVIGATE re-anchors the
reference axis (`snapReferenceTo`), OBSERVE rolls the quaternion by
`renderedRollError`.

**Known inconsistency, left in on purpose:** the drag-time snap-to-level guide
sticks to `coordSphereNorthPole(filter.coordSphere)` — the *displayed* grid —
while this instrument levels against whichever frame its chip selects. Pick
`ECL` here and the 2° guide during a Shift-drag still sticks to galactic or
equatorial. Unifying the two is part of what the spike is for.
