# Heliopause boundary

Sol's heliopause as a translucent asymmetric shell — Sol-only, built on
the shared `../../fresnel-shell/` primitive (material + shader pair +
gating base) and registered as a full boundary-shell focus target.

## Files in this area

```
src/client/solar-system/heliopause/
  heliopause.ts (+ test)          The asymmetric ellipsoid shell, its
                                  Sol-anchored sample points
                                  (HELIOPAUSE_SAMPLE_POINTS_SOL,
                                  HELIOPAUSE_APEX_SOL_PC), and the
                                  declutter/recentre gating.
```

## Geometry

Asymmetric ellipsoid centred on Sol, aligned to the interstellar-medium
inflow — the direction the heliosphere's nose points. Geometry is fixed
(no `t` dependence on human timescales):

- Upwind boundary at **122 AU** — Voyager 1 heliopause crossing,
  2012-08-25.
- Flank inferred at **~115 AU** from Voyager 2 heliopause crossing
  2018-11-05, combined with the apex-aligned ellipsoid model.
- Heliotail at **200 AU** — IBEX / Cassini ENA estimate.
- Nose (upwind apex) direction: the IBEX/Ulysses interstellar He
  inflow, J2000 ecliptic (λ, β) = (255.7°, 5.1°) ≈ ICRS RA 17h00m,
  Dec −17.6° (McComas et al. 2015, ApJS 220, 22). NOT the solar apex
  of motion vs nearby stars (RA 17h53m, Dec +27.4°), which sits ~47°
  away and once shipped here — the heliosphere is shaped by motion
  relative to the Local Interstellar Cloud.
  `../ephemerides/sky-truth.test.ts` pins the direction and the ~30°
  Voyager 1 off-nose sanity check.

Construction: unit sphere → scale to (115, 115, 161) AU → translate
the centre 39 AU toward antiapex → rotate so +Z lands on the antiapex.
Result: upwind apex at +122 AU, downwind at −200 AU along the apex.

## Anchoring and rendering

The shell, its label samples, and the hover picker all anchor on Sol,
whose renderer-local position is `-worldOffset` (Sol is the catalog
origin) — non-zero under planet focus. The group recentres via the
scene-layer `recenter` hook; the label engine and picker subtract the
live `worldOffset` from the exported Sol-anchored sample points
(`HELIOPAUSE_SAMPLE_POINTS_SOL`, `HELIOPAUSE_APEX_SOL_PC`).

Rendering uses a Fresnel limb-darkening fragment shader: alpha peaks
at the silhouette where the view ray grazes the surface and falls to
a small floor face-on, so the upwind apex region doesn't paint the
shell as a flat disc against the starfield. Back-face culling means
the shell disappears from inside (Sol focus, zoomed in) — this is
intentional, since from inside there's nothing geometrically
informative to show.

The "Heliopause" SVG label is anchored to the upwind apex's projected
silhouette by `createHeliopauseLabel`, mounted by the shell module's
`labels()` leg. The shell itself has
no distance-based render cutoff, so the label gates on
`isShellLabelResolvable` (`../../fresnel-shell/README.md` § Boundary shells
as focus targets) — the shell's projected angular radius at the true
camera distance must clear the shared `FEATURE_LEGIBILITY_MIN_PX`, or the
label would outlive the shell's legibility as the camera zooms out. Same
screen-size floor the planet labels ride via the orbit-ring gate.

## Heliopause as a focus target

The heliopause is a full boundary-shell focus target (`shell`
`TargetKind`): searchable, focusable, warpable, pinnable, hoverable —
one of the shell kind module's two instances, registered into its
internal `ShellRegistry` on attach (center = Sol, extent = the 200 AU
downwind apex, SID = `SHELL_OBJECT_SIDS.heliopause`, card +
`HELIOPAUSE_SAMPLE_POINTS_SOL` pick surface). Search / focus card /
hover / click-pick all route through the module's legs
(`../../fresnel-shell/README.md` § Boundary shells as focus targets) —
there is no heliopause-specific hover or picker anymore.

**Visibility is declutter-governed, not focus-coupled.** The shell (and
its apex label) render whenever the `heliopauseShell` /`heliopauseLabel`
declutter floors permit + chart mode is off — exactly like the Local
Bubble, and independent of focus (a warp changes focus but not shell
visibility). It was previously gated on Sol-focus; the declutter cycle now
covers it, so `shellReady()` is simply `true` (the mesh is built in the
ctor). The hide-when-inside back-face cull still applies, so near Sol
(camera inside) it's hidden and unpickable regardless. A shell far enough
to be sub-pixel still draws today — a ~1px LOD cull is tracked separately.

## Gotcha

- **Label visibility.** Hidden when the camera is inside the
  shell (near-plane bail), in chart mode / below the `heliopauseLabel`
  declutter floor, or when the shell's projected angular radius drops
  below the shared `FEATURE_LEGIBILITY_MIN_PX`. The legibility gate is
  also what keeps it away from non-Sol focus — from light-years off, Sol's
  ~200 AU shell reads sub-pixel. Don't add a "show always" toggle without
  thinking through the gating.
