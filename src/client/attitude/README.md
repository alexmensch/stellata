# Attitude indicator

Stellata has no canonical up, only conventions. This is the instrument that
tells you which way you are oriented: an FDAI-style gyro-sphere — the Apollo
8-ball, rendered as a real sphere — reading the camera quaternion against a
reference frame that follows whatever is focused.

The prior art is worth knowing, because it settles the design: Apollo carried
no single up either. Its 8-ball read against a REFSMMAT — a matrix the crews
swapped per mission phase — and the Shuttle ADI put the choice on a switch
(INRTL / LVLH / REF). Real spacecraft pick a reference by regime, which is what
the focus rule below does, and capture one on demand, which is what right-click
does.

## Files

```
attitude-pure.ts (+ test)  Frame table (equatorial / ecliptic / galactic /
                           captured REF), the camera→(pitch, bank, longitude)
                           read, and the ball's model matrix.
attitude-ball.ts           The painted grid texture and the standalone mini
                           renderer that draws the sphere.
attitude-indicator.ts      The instrument: canvas + fixed SVG chrome, the
                           corner frame flag, and the level affordances.
orbit-plane.ts             The focused object's own orbit — plane normal
                           and the direction to the orbit's centre —
                           dispatched to whichever subsystem holds it.
```

## Which frame, and who chooses

`autoFrameFor` reads the focused object: **ecliptic** across Sol's system —
that is the plane its planets actually orbit in — with **Earth** the single
exception, where RA/Dec is the frame anyone reading the sky from the surface
already thinks in, and **galactic** beyond, the only frame out there still
defined by something real.

Two overrides, both outranking the rule until the focus next changes: the
corner flag cycles EQU → ECL → GAL, and **right-clicking the ball captures
REF** — a datum planted on the attitude held right now, so the ball reads 0/0
level from here. That is the Shuttle's ATT REF button, and it is the answer to
"what is level outside the galaxy", where no inherited frame means anything.

`nextFrameKey` rotates the cycle so the focus default leads. Rotating a cycle
leaves every successor unchanged, so this only bites **on the way out of REF**:
a captured datum sits outside the cycle and has no successor of its own, and
falling back to a fixed first entry would strand you on a frame that means
nothing where you are.

`level()` — a click on the ball, or `L` — zeroes **roll only**. Levelling
pitch would move the camera through space in NAVIGATE, where it orbits a
target rather than turning in place.

A third override joins them: **double-clicking the ball, or `Shift`+`L`,
captures ORB** — a frame on the orbital plane of whatever is focused — and
levels on it. § Levelling on an orbit.

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
  aircraft convention.

Pitch and longitude are read but not printed: the ball shows them directly,
which is the point of a sphere over a flat horizon. Only bank drives chrome —
it aims the roll caret.

Near the pole the level up shrinks to nothing and the bank stops being a
measurement. Inside `POLE_HOLD_DEG` (1°) the read declines to write bank at all
and the last one stands, so crossing the pole doesn't swing the caret on float
noise. Outside it the caret tracks honestly, including the genuinely twitchy
band just beyond.

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

Everything is drawn from the app's own two tones — `#e6edf7` for the light
hemisphere, `#070912` for the dark one — with each hemisphere's markings in the
other's colour. They match the dark page palette's `--fg` and `--bg` but are
**held fixed as `BALL_LIGHT` / `BALL_DARK`** rather than read from it, because
the ball is a painted object rather than a surface of the page: it looks the
same in chart mode as anywhere else, the way a real instrument face does.

That fixes where every piece of chrome takes its colour, and the line is the
ball's edge:

- **Over the ball** — the roll caret and the amber index cross. Read against
  the ball, so they take the fixed tones, painted straight onto the SVG by
  `attitude-indicator.ts`. Following the page theme here inverts the caret's
  light triangle onto its dark inset under `body.monochrome` and the chevron
  disappears.
- **Outside it** — the roll scale's ticks, the bezel, and the frame flag. Read
  against the page, so they take `--fg` / `--border-strong` from the stylesheet
  and flip with it. The flag also needs its own `body.monochrome` background
  rule, since a translucent panel ground cannot come from a token. **The mid-tone orbit-ring blue
(`../util/orbit-line.ts`'s `ORBIT_LINE_COLOUR`) was considered for the light
and rejected:** the equator and prime meridian carry a tick every 2°, and a
hairline at that pitch needs the full contrast range against its ground. Amber survives only on
the centre cross, which is the one thing that must never be mistaken for a
grid line.

The graticule follows the FDAI rather than a map: solid lines every 30°, and on
the 15° offsets **no line at all** — a track of ticks every 5°, drawn
perpendicular to the line they stand in for. Where two tracks cross they read as
the little `+` the real ball is covered in.

Two lines carry a real scale instead, both ticked every 2°:

- **The prime meridian** is a dark line flanked by two light rails of equal
  thickness, painted *unclipped* so each hemisphere shows whichever half
  contrasts — a plain dark line across the light side, a split light rail
  across the dark one. Its ticks take the hemisphere's opposite ink.
- **The equator has no line of its own.** It is the seam between the two
  hemispheres, and that is the whole argument for a two-tone ball. It carries
  dark ticks running north into the light side only.

Numerals are the FDAI's: tens of degrees with the trailing zero dropped (`3`
for 30°), one size throughout, and **always degrees — never hours**, whichever
frame is selected. Latitude drops its sign as well, because the hemisphere's
colour already says south. A bare `3` is therefore both 30° of latitude and 30°
of longitude; position on the ball disambiguates them, exactly as it does on
the real instrument.

Because none of that depends on the frame, **the texture is built once** and
switching frames only re-aims the ball.

**Everything measured east-west widens by `lonStretch` = 1/cos(lat).** A degree
of longitude is only `cos(lat)` of arc, so a fixed texture width tapers to
nothing at the poles — which is exactly where a reference is most needed and
hardest to read. The meridians are therefore filled *ribbons* rather than
strokes (`meridianRibbon`), and the same correction widens the prime rail, the
vertical tick tracks' stroke width, the horizontal ticks' length, and the
numerals' glyphs. Out of proportion at the poles by construction; that is the
real ball's bargain, and the reason its rail stays solid at any attitude. The
correction is clamped near 78°, past which it diverges.

No red polar zone. The real ball wore one to warn of gimbal lock approaching,
which is a mechanical failure this has no analogue for.

## Rendering

`attitude-ball.ts` owns a **second `THREE.WebGLRenderer`** on its own small
canvas — deliberately not a viewport pass on the main one, whose every draw
lands in the HDR target and would take scene exposure and tone-mapping with it
(`../hdr/README.md`). A separate context is the cheap way to keep instrument
chrome out of the physical light path.

It redraws only on ticks where `camera.quaternion` actually changed **and the
instrument is on screen** — `display: none` suppresses the composite, not the
draw, so hiding with `U` would otherwise keep a sphere rendering that nobody
can see. A tick skipped while hidden is remembered, so the ball catches up on
the first frame after it returns rather than showing a stale attitude.

The texture is built once for the life of the page — the frame chip re-aims
the ball rather than repainting it — and so is the renderer: the instrument is
created once at boot and lives as long as the document, so its context and GPU
objects are released by the page unload that ends them.

The grid is painted at `TEX_W` × `TEX_H`, and every stroke in `attitude-ball.ts`
is measured in **degrees** rather than texture pixels, so that pair is a free
parameter. It is sized off what the ball can actually resolve: `BALL_PX` CSS
pixels at a device ratio of at most 2 puts under 3 texels per degree at the
ball's centre, and the texture carries about twice that.

## Case chrome

The fixed chrome over the canvas is SVG, and two pieces of it are deliberately
un-aviation:

- **The roll scale runs the full 360°** — ticks every 5°, stepping up at 10°,
  30° and 90°. An aircraft indicator marks only the shallow band either side of
  level because that is where an aircraft lives; roll here is unbounded, so a
  scale that ran out would be worse than none.
- **The centre index is a cross, not a pair of wings** — four arms and a point,
  sized off `BALL_R` so it tracks the ball's size, then trimmed 5%.

**The stage is clipped to its own disc** (`clip-path: circle(50%)`), which
clips hit-testing as well as paint. The instrument is round and its box is
square, so the corners are 44px clear of the outermost tick; without the clip
they would swallow a click meant for the sky and level the camera instead. The
frame flag sits in one of those corners and is therefore a sibling of the
stage, not a child of it.

`U` hides the instrument along with the rest of the controls
(`../ui/README.md` § Hide-controls toggle). No focus ring ever appears on it:
the ball is not a tab stop — the keyboard path is `L` — and the flag's focus
state is a border brighten rather than a UA outline, because a blue ring over a
WebGL canvas reads as a rendering fault.

The roll caret is the FDAI's: a light **equilateral** triangle carrying a dark
**isoceles** one on the *same base segment*, `INSET_BASE_FRAC` (0.36) as wide
and `INSET_HEIGHT_FRAC` (0.99) as tall. The light therefore survives as a
chevron — solid at the
tip, tapering to nothing at the base corners — and that bright wedge is what
keeps the caret legible whichever hemisphere is passing underneath. Scaling a
second equilateral triangle inside the first is the wrong shape: it leaves an
even border rather than a chevron.

## Levelling on an orbit

Double-click the ball (or `Shift`+`L`) and the active frame becomes **ORB**,
whose pole is the normal of the orbit the focused object *itself* rides. It
is a captured datum like REF, planted from `orbit-plane.ts`'s answer rather
than from the current attitude, and `level()` then runs unchanged.

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

Capturing rather than only rolling is what makes it legible: rolling to a
plane the instrument is not displaying leaves the caret reading un-level
against the *old* frame, so the gesture would look like it had failed.

**Always the innermost orbit the object is on.** Luna levels on its orbit
about Earth, not Earth's about Sol; Algol Aa2 on its tight inner pair, not
on the wide Aa-Ab one its primary also belongs to. Each subsystem answers
from its own elements — `PlanetBodyField.orbitPlaneNormalOf` /
`orbitCentreOffsetInto` for a body (`../solar-system/ephemerides/README.md`
§ Orbit rings), `starOrbitNormalIcrs` plus `innermostRelationOf`'s partner
slot for a pair (`../binaries/README.md` § Which pair a star rides).

**The obvious shortcut is wrong and must stay unused here.**
`orbitalPlaneNormalFor()` answers per HOST STAR — the ecliptic for Sol,
galactic otherwise — so routing a body through it would level every
solar-system object on the ecliptic and every moon on the wrong plane, while
looking exactly like a working feature.

Two silent no-ops, both deliberate, both because the plane on offer would be
a convention dressed as a measurement: a **Tier-2 pair** (no published
inclination, so its plane is the galactic fallback) and a **host with no live
element source** (its rings fall back to `defaultOrbitGeometry`, flat on the
host plane). Kinds that ride no orbit at all — probes, clouds, shells — are
the third, and the ordinary one.

The normal is a static function of the elements, not a sampled one: an orbit
is planar, so `r(t) × r(t+dt)` recovers only what `Rz(Ω)·Rx(I)·Rz(ω)` and the
Thiele-Innes basis already state exactly, and it degenerates whenever the two
samples come back near-parallel.

Retrograde orbits keep their sense. Triton's normal points south of the
ecliptic and levelling on it inverts the view, because that is where its
angular momentum points.

## Levelling

The two camera modes need different calls, matching the split in
`../camera/controls/input/README.md` § Snap-to-level: NAVIGATE re-anchors the
reference axis (`snapReferenceTo`), OBSERVE rolls the quaternion by
`renderedRollError`.

**Known inconsistency:** the drag-time snap-to-level guide sticks to
`coordSphereNorthPole(filter.coordSphere)` — the *displayed* grid — while this
instrument levels against whichever frame the flag holds. Pick `ECL` here and
the 2° guide during a Shift-drag still sticks to galactic or equatorial.
