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

## Markings and palette

Everything is drawn from the app's own two tones — `--fg` `#e6edf7` for the
light hemisphere, the settings panel's `#070912` for the dark one — with each
hemisphere's markings in the other's colour. **The mid-tone orbit-ring blue
(`../util/orbit-line.ts`'s `ORBIT_LINE_COLOUR`) was considered for the light
and rejected:** the equator carries a tick per degree, and a hairline at that
pitch needs the full contrast range against its ground. Amber survives only on
the centre cross, which is the one thing that must never be mistaken for a
grid line.

The graticule follows the FDAI rather than a map: solid lines every 30°, and on
the 15° offsets **no line at all** — a track of ticks every 5°, drawn
perpendicular to the line they stand in for. The equator is the exception and
carries a real scale: a light belt (which is why the dark hemisphere starts at
−3° rather than 0°), a solid line on it, and a tick per degree stepped up at 5°
and 10°.

**A tick per degree is finer than the ball's own pixels.** The visible half of
the equator spans 180° across roughly the ball's diameter, so the comb lands
under a pixel per tick and will read as a textured band rather than countable
ticks. That is faithful to the instrument and deliberate; coarsening the step
is a one-line change in `paintEquator` if it reads as mush.

No red polar zone. The real ball wore one to warn of gimbal lock approaching,
which is a mechanical failure this has no analogue for.

## Rendering

`attitude-ball.ts` owns a **second `THREE.WebGLRenderer`** on its own small
canvas — deliberately not a viewport pass on the main one, whose every draw
lands in the HDR target and would take scene exposure and tone-mapping with it
(`../hdr/README.md`). A separate context is the cheap way to keep instrument
chrome out of the physical light path.

It redraws only on ticks where `camera.quaternion` actually changed, so a
static view costs nothing. The grid texture is rebuilt only when the frame
chip changes, since only its labels differ.

## Case chrome

The fixed chrome over the canvas is SVG, and two pieces of it are deliberately
un-aviation:

- **The roll scale runs the full 360°** — ticks every 5°, stepping up at 10°,
  30° and 90°. An aircraft indicator marks only the shallow band either side of
  level because that is where an aircraft lives; roll here is unbounded, so a
  scale that ran out would be worse than none.
- **The centre index is a cross, not a pair of wings** — four arms and a point,
  sized off `BALL_R` so it tracks the ball's size, then trimmed 5%.

The roll caret is the FDAI's: a light triangle carrying a dark one inset inside
it, stopping short of the tip. The surviving bright wedge is what keeps it
legible whichever hemisphere happens to be passing underneath.

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
