# Attitude indicator — spike

**Throwaway.** A branch-only experiment in giving the camera an aircraft-style
attitude indicator so the viewer always knows which way is "up" relative to a
chosen reference plane. Delete the folder and its three wiring lines
(`index.html`, `main.ts`, `styles.css`) and nothing else changes.

## Files

```
attitude-pure.ts (+ test)  Frame table (equatorial / ecliptic / galactic) and
                           the camera→(pitch, bank, longitude) read.
attitude-indicator.ts      The SVG instrument, bottom-left above the scale bar,
                           plus click-to-level and the frame-cycle chip.
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
that twitch is the honest reading, and worth watching before deciding whether
the shipped version should damp it.

## Levelling

Clicking the instrument zeroes the **roll** only — the boresight does not move.
That is deliberate: in NAVIGATE the camera orbits a target, so pitching to the
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
