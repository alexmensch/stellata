# Attitude indicator

Stellata has no canonical up, only conventions. This is the instrument that
tells you which way you are oriented: an FDAI-style gyro-sphere — the Apollo
8-ball, rendered as a real sphere — reading the camera quaternion against a
reference frame that follows whatever is focused.

**Navigate mode only.** It lives in the Instruments panel bottom-left
(`../ui/README.md` § Layout containers) and hides on entering observe, where
the drawn coordinate sphere carries the frame instead
(`../galactic/coord-spheres/README.md`). One instrument answering "which way
is north" at a time is the point: while both were on screen they held separate
frames and disagreed.

The prior art is worth knowing, because it settles the design: Apollo carried
no single up either. Its 8-ball read against a REFSMMAT — a matrix the crews
swapped per mission phase — and the Shuttle ADI put the choice on a switch
(INRTL / LVLH / REF). Real spacecraft pick a reference by regime, which is what
the focus rule below does, and capture one on demand, which is what the REF
chip does.

## Files

```
attitude-pure.ts (+ test)  Frame table (equatorial / ecliptic / galactic,
                           plus the captured REF and ORB), the
                           camera→(pitch, bank, longitude) read, and the
                           ball's model matrix.
attitude-ball.ts           The painted grid texture and the standalone mini
                           renderer that draws the sphere.
attitude-layout.ts (+ test) The mini-renderer's view geometry, the sphere's
                           silhouette that follows from it, the design box
                           the chrome is drawn in, and what the instrument
                           measures on the page.
attitude-indicator.ts      The instrument: canvas + fixed SVG chrome, the
                           three corner chips, and the level affordances.
orbit-frame/               ORB: the focused object's own orbital plane,
                           and the gesture that levels on it. Its README
                           is the authority on that frame.
focus-frame.ts             The focused object as the frame rules read it,
                           resolved once so the instrument and the
                           coordinate spheres ask the same question.
```

## Which frame, and who chooses

**The selected frame is `filter.coordSphere`** — the same field the panel's
coordinate-sphere row and `S` write, and the same one that names the drawn grid
in observe. The instrument does not hold a frame of its own; it reads that
selection, resolving `none` to the focus default because a ball, unlike a sky,
cannot read against nothing.

`autoFrameFor` is that default: **ecliptic** across Sol's system — the plane
its planets actually orbit in — with **Earth** the single exception, where
RA/Dec is the frame anyone reading the sky from the surface already thinks in,
and **galactic** beyond, the only frame out there still defined by something
real.

**A frame is only offered where it describes something.**
`frameAvailableFor` reads that off `autoFrameFor` rather than restating "in
Sol's system", so the two cannot drift: galactic everywhere, the ecliptic
wherever the focus rule already lands inside Sol's system, RA/Dec on Earth
alone. `frameAfterFocusChange` then keeps a selected frame across a focus
change where the new object still allows it and demotes to that object's
default where it does not — `../galactic/coord-spheres/README.md` § A frame is
offered where it describes something carries the walk and why the rule is
keyed on the focus rather than on distance. **A manual pick therefore
survives** a focus change now, where it used to be reset every time; only a
pick the new object cannot support is taken away.

Two captured frames sit outside the selection, both held on the instrument and
both cleared when the focus moves out from under them:

- The corner flag cycles **ORB → GAL → ECL → EQU**, matching the panel's
  order. Every entry is conditional — ORB on the focused object riding an
  orbit the model has elements for, the sky frames on `frameAvailableFor` —
  and `nextFrameKey` skips what is not on offer. Galactic is available
  everywhere, so the walk always terminates. Picking a sky frame writes
  `filter.coordSphere`; picking ORB captures the plane exactly as the gesture
  does but **does not level**, the flag choosing what the ball reads against
  and levelling being the gesture's own half of the job (§ Levelling on an
  orbit).
- The **REF chip** top-left captures a datum on the attitude held right now,
  so the ball reads 0/0 level from here. That is the Shuttle's ATT REF button,
  and it is the answer to "what is level outside the galaxy", where no
  inherited frame means anything. A datum planted on a live attitude has no
  fixed place in a rotation, which is why it is a **toggle rather than a flag
  entry**: one control arms it and clears it, and clearing drops back to
  whatever the flag is reading rather than to an arbitrary first entry.
  Right-clicking the ball captures the same datum and drives the same toggle.
  While REF is held the flag keeps reading the frame underneath — that is
  what you return to — and the lit chip is what says the ball is not on it.

`S` steps the flag on from the keyboard, and is the same key that steps the
drawn grid in observe (`../ui/README.md`). It never hides the instrument;
only `U` does.

`level()` — a click on the ball, or `L` — zeroes **roll only**. Levelling
pitch would move the camera through space in NAVIGATE, where it orbits a
target rather than turning in place.

One gesture reaches ORB directly: **double-clicking the ball, or `Shift`+`L`,
captures it** — a frame on the orbital plane of whatever is focused — and
levels on it. `orbit-frame/README.md`.

The **INV chip** in the bottom-right corner is not a frame at all; it moves
the camera rather than choosing what to read it against. § Inverting the view.

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
grid is a true miniature of the coordinate sphere the scene draws in observe —
step to the same frame and the lines agree — with the boresight at the centre.

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

  **The cross is drawn twice**, `INDEX_AMBER` (`#ff9d0a`) over a hairline of
  `BALL_DARK`. Amber clears 9.5:1 against the dark hemisphere and 1.8:1
  against the light one, and **no warm colour clears the 3:1 a non-text
  graphic wants on both** — warmth is brightness, so a colour bright enough to
  read as amber cannot also separate from a near-white ground. The outline is
  therefore the fix and the hue is the polish: `BALL_DARK` against the light
  hemisphere is 16.9:1, and the amber then only has to separate from the
  outline. `SYMBOL_OUTLINE` is half a design unit either side, about a pixel
  once CSS stretches the box; heavier reads as a second graphic rather than
  an edge.
- **Outside it** — the roll scale's ticks, the bezel, and the chips. Read
  against the page, so they take `--fg` / `--border-strong` from the stylesheet
  and flip with it. The flag also needs its own `body.monochrome` background
  rule, since a translucent panel ground cannot come from a token. The one
  crossing of the line is the **held REF chip**, which fills in the index
  cross's own colour because that is the thing it is reporting on — so
  `attitude-indicator.ts` publishes `INDEX_AMBER` and `BALL_DARK` to the
  stylesheet as `--ai-index` / `--ai-index-ink` rather than letting a second
  copy drift off the cross. Dark ink on that fill is 9.5:1; the light tone
  would be 1.8:1. **The mid-tone orbit-ring blue
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
draw, so a hidden instrument would otherwise keep rendering a sphere nobody can
see. There are now four ways to hide it and `offScreen()` has to answer all of
them: observe mode, `U`, the Instruments panel collapsed, and the Attitude
indicator section collapsed. All four are class or attribute reads rather than
layout queries, so the per-tick check stays free. A tick skipped while hidden
is remembered, so the ball catches up on the first frame after it returns
rather than showing a stale attitude.

The texture is built once for the life of the page — the frame chip re-aims
the ball rather than repainting it — and so is the renderer: the instrument is
created once at boot and lives as long as the document, so its context and GPU
objects are released by the page unload that ends them.

The grid is painted at `TEX_W` × `TEX_H`, and every stroke in `attitude-ball.ts`
is measured in **degrees** rather than texture pixels, so that pair is a free
parameter. It is sized off what the ball can actually resolve.

The ball's centre is where the sphere resolves most finely: there its surface
faces the viewer square-on, so a degree of arc spans `BALL_R` × π/180 pixels
and nothing on the ball is denser. At a device ratio of at most 2 that is
**~3.3 device pixels per degree**, against the texture's 5.7 — so the texture
still out-resolves the screen by ~1.7×, and mip selection lands near the top
level with anisotropy carrying the oblique periphery.

That margin is the number to re-check whenever the instrument is resized, and
it is why `TEX_W` stayed at 2048 through the 240px enlargement: the ratio fell
from ~2.1× but never approached 1, where the texture would start to blur.
Restoring a 2× margin would mean 2560 × 1280 — a third more VRAM for a
permanent instrument texture, against no visible difference.

## Sizing

`attitude-layout.ts` owns every number the instrument is built from, and the
split that makes resizing one edit is between **design units** and **rendered
pixels**.

The SVG chrome is drawn in a fixed 192-unit design space and CSS stretches it
to whatever width the Instruments panel gives it. Nothing in the drawing code
knows the instrument's real size, so strokes, tick lengths, the caret and the
index cross all scale together — a larger instrument is genuinely larger
rather than a bigger ball inside the same hairlines.

**The instrument fills its panel column**, so the one number crossing into CSS
is a ratio rather than a size: `--ai-ball-frac` = `BALL_PX / BOX`, the ball's
share of the square box, set on the host and consumed only by classes in
`../styles.css`. The invariant holding the two spaces together is that
**`BALL_RASTER_PX / RENDERED_BOX_PX` equals `BALL_PX / BOX`** — the canvas is
placed by CSS while the bezel around it is drawn in design units, and a bezel
that no longer hugs the ball is what breaking that ratio looks like.
`attitude-layout.test.ts` pins it.

`RENDERED_BOX_PX` is now the width the ball's raster resolution was **chosen
against** rather than the width it renders at; `BALL_RASTER_PX` is a drawing
buffer, not a layout box. The panel column is a little wider than that, so the
texture margin in § Rendering absorbs a few per cent of upscale — which is the
number to re-check if `--panel-width` ever grows materially.

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
square, so the corners are clear of the outermost tick; without the clip they
would swallow a click meant for the sky and level the camera instead. The
three corner chips sit in those corners and are therefore siblings of the
stage, not children of it — REF top-left, the frame flag top-right, INV
bottom-right. They share `.attitude-chip` and differ only in which corner they
hang from.

`U` hides the Instruments panel along with the rest of the controls
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

## Levelling

The two camera modes need different calls, matching the split in
`../camera/controls/input/README.md` § Roll authority: NAVIGATE puts
`camera.up` on the frame's pole (`levelTo`), OBSERVE rolls the quaternion by
`renderedRollError`.

**They also level against different things**, because the instrument is not on
screen in observe: there `L` reads `coordSphereNorthPole(filter.coordSphere)`
— the pole of the grid actually drawn — and is a **no-op while that is
`none`**, there being nothing on screen to level to rather than a hidden frame
to guess at. `Shift`+`L` is navigate-only for the same reason: ORB is the
instrument's own frame and has no grid behind it.

Level is a one-shot state, not a maintained one — orbiting away from here
rolls the view again, and the ball is what tells you so.

## Inverting the view

The **INV chip** reflects the camera through whatever it is looking at, and
the two camera modes reach that from opposite starting points:

- **NAVIGATE** — the camera orbits the focused object, so the offset from the
  pivot is negated. The far side comes into view at the same distance, still
  looking at the object. Aim the HUD arrow at Sol from Earth, then invert, and
  you are reading Earth from Sol's direction instead of Sol from Earth's.
- **OBSERVE** — the camera sits *on* the object and there is no orbit to
  swing through, so the position is held and it turns to face the reciprocal
  direction.

**A half turn has no unique axis.** Every plane containing the two poses is an
equally valid path, so the endpoint is well defined while the route is not,
and left to a bare quaternion slerp the camera tumbles through whichever plane
the arithmetic happens to pick. The sweep is therefore pinned about the
camera's **own up**, which reads as a horizontal swing. That the camera's
local up is perpendicular to the boresight by construction is also what makes
the half turn land exactly on the reciprocal rather than near it.

The motion itself is `AimController.invert`
(`../camera/controls/README.md` § Aim controller); the chip calls
`Stellata.invertView`, which carries the same busy gates as `aimAt`. Both
modes compose the same half-turn quaternion onto their own start pose, so
there is one definition of "inverted" rather than a per-mode approximation.

It is not gated on having a focus: with none, navigate swings around whatever
`controls.target` currently holds, which is the point the camera was already
orbiting.

`Shift`+`V` is the keyboard path, and it is not a convenience: the chip rides
a navigate-only instrument, and inverting the view is just as useful standing
on a planet.
