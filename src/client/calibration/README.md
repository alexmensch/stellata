# Display calibration

A full-bleed screen of authored sRGB patches that tells the user how to
set their display so the shipped perceptual constants land as intended —
and gives the maintainer a known display state to capture new ones
against.

## Files in this area

```
src/client/calibration/
  calibration-ladders-pure.ts   Patch code values: the black-point and
    (+ test)                    highlight ladders, the grey wedge, and the
                                gamma→code-value inversion.
  gamma-pattern.ts              Draws one gamma match cell (patch inside a
                                50/50 line pattern) at device-pixel pitch.
  calibration-overlay.ts        Builds the swatches, wires the reveal
                                toggle and dismissal, owns the open handle.
```

## Deliberately non-photometric — and outside the render path

Every patch is a DOM element (or a 2D canvas) at an **authored sRGB code
value**. Nothing here goes through `../hdr/` — no exposure, no tone-map,
no dither. That is the point: the screen has to show the transfer the
display actually applies, not the one the operator produces.

CSS colours and WebGL canvas output take the same OS display transform,
so a DOM target is representative of what the scene shows. What it
cannot see through is display-profile conversion — on a non-sRGB profile
the browser converts these values before they reach the panel, and code
value 1 may land on 0. That affects the scene identically, so the reading
stays honest, but it is why the black ladder starts at 1 rather than
assuming code 1 survives.

**The surround is load-bearing.** The surface is code-value `#000` with
nothing translucent, blurred, or filtered over it. Adding a
`backdrop-filter`, a non-black background, or an opacity to
`.calib-surface` changes the very readings the screen exists to take.

## The four sections

| § | Patches | What it catches |
| --- | --- | --- |
| Black point | `1 2 3 4 6 8 11 16` on `0` | shadow crush — the failure that matters most, since the scene is faint sources on black |
| Highlights | `238…254` on `255` | top-end crush, which is what the resolved-surface pin compensates for |
| Grey ramp | 16 steps `0`→`255` | whole-transfer sanity check |
| Gamma | `174 180 186 191 195` | the display's actual exponent, γ `1.8`–`2.6` |

**Black point is the only actionable one.** It is the section written to
be acted on with a brightness key, and the copy says so; the other three
are readings. Highlights and gamma in particular are usually not
adjustable at all on a laptop panel — the screen reports them so a
constant captured here can record the state it was captured in.

Nothing is persisted. The reading is legible on screen and that is its
whole delivery mechanism — there is no consumer in the render path, so
storing it would be a persistence surface with no reader. A future pass
that feeds a black-lift or gamma trim back into the tone-map resolve is
what would earn that storage, and it is not this.

## Gamma — why the stripes are device pixels

A 50/50 black-white line pattern averages to **0.5 linear luminance**, so
the solid patch matching it has code value `255 · 0.5^(1/γ)`
(`gammaMatchCode`). The patch that disappears names the display's gamma.

That identity only holds while the eye integrates the stripes instead of
resolving them, which is why `gamma-pattern.ts` scales its backing store
by `devicePixelRatio` and fills **one device pixel per stripe**. A CSS
`1px` pattern is two device pixels on a 2× display: the stripes become
resolvable and every match point shifts.

The cell measures its own laid-out box rather than carrying fixed
dimensions, so it tracks § Sizing. That makes **layout a precondition**:
a still-hidden canvas measures zero and is skipped, so the cells are cut
*after* `handle.open()`, never before. They are re-cut on `resize`, which
covers both a viewport change and a window dragged between displays of
different pixel ratios.

### The reference is sRGB, not γ2.2

**sRGB is not a 2.2 power law**, and treating it as one is the trap this
section is built to avoid. It is a 2.4 exponent on a shifted curve with a
linear toe, so solving `../hdr/tonemap/tonemap.glsl`'s actual encode for linear
0.5 gives code value **188** — between the 2.2 stop (186) and the 2.4 one
(191), equal to neither. A screen that marks γ2.2 as the target therefore
tells a correctly behaving display that it is wrong.

So `srgbMatchCode()` derives the reference patch from `srgbEncode` itself
(`../hdr/tonemap/tonemap-pure.ts`, the CPU mirror of the shipped chunk) rather
than restating a power-law approximation of it. Change the output
transfer and the calibration target follows; there is no second constant
to keep in step. `GAMMA_STOPS` stays as a *scale* for reading how far a
display sits from the reference — the stops are not targets, and
`gammaCells()` is what interleaves the two and flags the one reference.

A reading one stop off the reference is not much of a signal: the stops
are ~5 code values apart at that end of the range, which is at the edge
of what this test resolves.

## Sizing

One custom property — `--calib-swatch` on `.calib-surface` — is the edge
length every patch on the screen derives from, so the four sections scale
as a unit. It is clamped on **both** axes (`min(8.4vw, 12.5vh)`): the
width term keeps the 8-wide black ladder inside the surface padding, the
height term keeps the sections from pushing the surface into a scroll on
a short viewport. Past those bounds the surface scrolls rather than
shrinking the patches below a readable size.

`--calib-columns` is published by `calibration-overlay.ts` from
`BLACK_POINT_CODES.length`; the grey wedge spans
`--calib-ladder-width` so it lines up with the black ladder at any
swatch size, without the stylesheet restating how long that ladder is.

The revealed white field is `inline-block`, not `block`. It is a
calibration target rather than a background, so it shrink-wraps its
patches — a full-viewport sheet of code value 255 is both useless as a
reading and hostile to the dark adaptation the screen just asked for.

## Highlights reveal on click

A white field on screen destroys the dark adaptation the black-point
section depends on, so section 2 stays collapsed until the user asks for
it, and re-collapses on close (`beforeClose`) so the next open starts
dark. This is the one piece of state the surface has.

## Entry points

The `calibrate` link in the panel's Camera section (below Exposure), and
the `K` shortcut. `bindCalibrationOverlay()` wires both and is called
once from `../ui/keyboard-shortcuts.ts`, mirroring `bindHelpModal`.

Dismissal is the shared `../modals/modal-dismiss.ts` contract. The root
carries `.modal` for exactly two reasons — the fixed inset-0 box, and the
ESC-chain guard in `../ui/keyboard-shortcuts.ts` that keys off that class
so the cascade doesn't run underneath an open overlay. Everything visual
is overridden by `.calibration`; there is no `.modal-backdrop` and no
`.modal-card`.
