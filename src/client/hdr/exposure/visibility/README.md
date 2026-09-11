# Is it visible? — the two predicates

Whether a source puts ink on screen at all, and whether a diffuse emitter
may skip its draw because it cannot. One module answers both, because both
run the same chain — a peak carried through the operator and the sRGB
encode, compared against half an 8-bit output step.

```
src/client/hdr/exposure/visibility/
  emitter-visibility-pure.ts   `emitterPutsInkOnScreen` (point sources),
    (+ test)                   `extendedEmitterPutsInkOnScreen` +
                               `brightnessSkip` (diffuse emitters), and
                               `FrameExposure`, the record the scene
                               registry hands every gated layer's `skip`.
```

The one dependency on the parent is `adaptationBranches`
(`../scene-adaptation-pure.ts`), which `brightnessSkip` runs twice per
verdict — with and without the emitter's own share — because it is the
only implementation of the branch block and a second copy could disagree
with the cut the frame actually applied.

## What "visible" means to a pick path

`uThresholdMag + SOFT_TAPER_MARGIN_MAG` is where the shaders stop
emitting. It is **not** where the user stops seeing, and the gap is
large enough to have shipped as a bug: clicks landed on stars in
apparently empty sky. Three terms sit between the two.

- **The taper's own endpoint.** `tap` is `1 − smoothstep(m_t, m_t + 0.5,
  m)`, so at the bound it is exactly 0. The last magnitude the cutoff
  admits emits nothing.
- **The faint-end toe.** It compresses sub-threshold light to black over
  `TOE_BLACK_MAG`, so the peak pixel crosses under half an 8-bit step at
  **0.3066 mag** past threshold, not 0.5.
- **Adaptation.** It is absent from all three magnitude bounds and rides
  `uExposure` instead, so a cut moves the visible edge and leaves every
  bound where it was. Past ~1.5 mag of cut the whole faint end is black
  while the bounds have not moved at all.

A fourth is not an exposure term but reaches the same conclusion:
`catalog.absmag` is stored **de-extincted**, so any CPU magnitude is
`A_V` brighter than what renders (`../../../star-pipeline/extinction/README.md`).

`emitterPutsInkOnScreen` answers the question the bounds cannot, by
running the chain instead of approximating it: point-source peak → taper
→ toe → extended Reinhard → sRGB, true iff the brightest pixel survives
8-bit quantisation. It takes the **live** `uExposure`, which is how
adaptation reaches it without any bound having to move.

It reads the emitter's peak from the star's **true** angular radius, the
one `star.vert.glsl` divides by before the viewport-fraction up-clamp
(`renderedSizeComponents`' `physSizePxUncapped`) — the clamped value
over-brightens a star at the zoom floor. Its half-step test is also one
side of the encode only: the pipeline dithers *after* the operator, so a
source a hair under half a step still lights a pixel on some frames. The
predicate is that much stricter than the frame at the very edge, which
errs toward "not pickable" on a star the user can barely see.

**Every term above only ever dims**, and that is what keeps the cheap
bounds useful: an intrinsic magnitude inside `drawCutoffMag` is a
conservative superset of what renders, so it stays the right *prefilter*
for a catalog-wide scan. Prefilter with the bound, decide with the
predicate — the star pick path (`../../../camera/controls/picker.ts`) is
the worked example, and it resolves candidates lazily because the
extinction term costs a GPU readback.

## Skipping an emitter the display cannot show

A diffuse emitter whose brightest pixel encodes under half an 8-bit step
at the live exposure skips its draw — statistic write included — under two
rules that keep the cut from moving with it:
`docs/science-hdr-pipeline.md` § 3.5 is the derivation and
`emitter-visibility-pure.ts` (`extendedEmitterPeakDisplayLevel`,
`brightnessSkip`) the one implementation, with the Milky Way band and the
Local Group pair as its users.

**Rule 2 refuses a skip within a band of the visibility edge, and the
band is the plate scale's** — it widens as the camera zooms out, because
the share bound carries `Ω_px` where the display carries `Ω_sum`. The
measured widths are § 3.5's, pinned in `emitter-visibility-pure.test.ts`.

