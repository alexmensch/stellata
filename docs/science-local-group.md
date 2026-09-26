# Local Group — wireframes & luminosity model

Covers the Local Group wireframe layer
(member selection, geometry) and the per-object luminosity/density
model used to calibrate the volumetric emission raymarch. Spans
`src/client/local-group/`, `data/local-group/`.

## Local Group wireframes

The Local Group wireframe layer renders LineLoop outlines for confirmed-
galaxy members out to the canonical 2 Mpc Local Group boundary —
M31 + M33 + the Andromeda subgroup, plus the outer dIrrs (NGC 6822,
IC 10, IC 1613, Leo A, WLM, Sextans A/B, …). Geometry is representational
(stylised LineLoop ellipsoids and discs), but every position, distance,
and structural parameter comes from peer-reviewed catalogues:

**Primary catalogue**: [Pace 2025](/data/papers/index.md#pace2025), *Local Volume
Database* (CC0). A frozen snapshot of
the `dwarf_all` table lives at `data/local-group/lvdb-snapshot.csv` —
909 rows covering the full Local Volume. The build pipeline
(`scripts/local-group/build-local-group.ts`) filters to `confirmed_real = 1`,
`confirmed_galaxy = 1`, and heliocentric distance ≤ 2 Mpc; ~121
objects pass the filter.

LVDB provides position (ra, dec, distance), projected half-light
radius (`rhalf_physical`), ellipticity, and position angle for each
dwarf. The build script projects these into a sky-plane oblate
ellipsoid for the default rendering path:

- `a_pc = rhalf_physical` (semi-major axis in the sky plane)
- `b_pc = a_pc · (1 − ellipticity)` (sky-plane minor axis)
- `c_pc = b_pc` (line-of-sight extent — axially symmetric around the
  projected major axis; line-of-sight 3D extent is generally not
  observationally constrained)
- Orientation: long axis at the catalogued position angle east of
  north; minor axes complete a right-handed basis with the line of
  sight.

**Hand-curated overrides** in `data/local-group/overrides.tsv` replace
structural detail for the singular cases LVDB's summary row can't
capture, and add the two major spirals LVDB's `dwarf_all` table omits:

- **LMC (49.59 kpc)**: inclined disc at i = 32°, line of nodes PA =
  135°. [van der Marel 2014](/data/papers/index.md#vandermarel2014)'s
  fits give i = 26.2–39.6° and Θ = 139.1–154.5° (Table 1), so neither
  value is theirs. Distance
  [Pietrzyński 2019](/data/papers/index.md#pietrzynski2019). Semi-axes
  4.5 kpc in the disc plane and 1 kpc normal to it — the wireframe
  extent, not the emission profile's R_d = 1.5 kpc below.
- **SMC (62.81 kpc)**: triaxial 1 : 1.33 : 1.61 with the longest axis
  along line of sight ([Subramanian 2012](/data/papers/index.md#subramanian2012);
  distance from LVDB's SMC row, µ = 18.99 ± 0.1 —
  [Cioni 2000](/data/papers/index.md#cioni2000), DENIS TRGB.
  [Graczyk 2020](/data/papers/index.md#graczyk2020)'s eclipsing-binary result is
  62.44 kpc, µ = 18.977; LVDB pins [Cioni 2000](/data/papers/index.md#cioni2000) and the two
  agree well within its
  ±0.1 mag uncertainty). Resulting semi-axes 3.73 / 4.96 / 6.0 kpc.
- **Sagittarius dSph (26.3 kpc)**: 3D axis allocation — LVDB's
  projected ellipticity captures the sky-plane shape but not the
  line-of-sight extent. [Ibata 1997](/data/papers/index.md#ibata1997) measure a
  red-clump line-of-sight depth of 1.2 kpc
  and conclude Sgr is a prolate spheroid with axis ratios 3:1:1. That
  depth is a full half-brightness depth, a ~0.6 kpc semi-axis, and
  their half-brightness minor axis is 2 × 550 pc; the override's
  semi-axes, 2616 / 942 / 1000 pc, are neither.
- **M 32 (~773 kpc)**: ellipsoid 1.6 / 1.2 / 1.2 kpc at PA 159°.
  LVDB's half-light radius of 105 pc renders sub-pixel at LG
  distances, so the override is broader. Its PA and axis ratio (0.75)
  match [McConnachie 2012](/data/papers/index.md#mcconnachie2012)'s
  PA = 159° and ε = 0.25 (Table 3); the review gives only a half-light
  radius (110 pc), not the 1.6 kpc extent.
- **NGC 205 / M 110 (~835 kpc)**: 2.7 / 1.5 / 1.5 kpc at PA 170°.
  The axis ratio (0.56) matches
  [McConnachie 2012](/data/papers/index.md#mcconnachie2012)'s
  ε = 0.43; the review's PA is 28° and its half-light radius 590 pc,
  and it gives no 2.7 kpc extent.
- **M31 / Andromeda (776 kpc)**: inclined disc at i = 77°, line of
  nodes PA = 37°, 15 kpc disc radius × 500 pc thickness. The
  inclination is the one
  [McConnachie 2018](/data/papers/index.md#mcconnachie2018)
  draw the PAndAS disc at (Fig. 4); their disc radius is 1.25° =
  17 kpc, and they give no PA or thickness. Standalone row
  (not in LVDB's `dwarf_all` table; the override carries RA, Dec,
  distance directly).
- **M33 / Triangulum (840 kpc)**: inclined disc at i = 54°, line of
  nodes PA = 22°, 8.5 kpc disc radius × 400 pc thickness — disc
  orientation from the tilted-ring fit of
  [Corbelli 2014](/data/papers/index.md#corbelli2014); distance from the near-infrared
  Cepheid measurement of [Gieren 2013](/data/papers/index.md#gieren2013)
  (µ = 24.62 ± 0.07). Standalone row.

Per the build's data-freshness policy ([Frozen external data](/data/README.md#frozen-external-data)),
refreshing the LVDB snapshot is an explicit
manual step (curl + `pnpm run build:local-group --force`) — `pnpm run
build` never touches the network.

Per the data-fidelity principle ([Scope principles](/SCIENCE.md#scope-principles)), hand-curated overrides are
the exception, reserved for objects with well-studied departures that
no canonical structural row resolves — or, in the case of M31 / M33,
for the major spirals that the LVDB `dwarf_all` table excludes by
construction. Other Local Volume dwarfs render from their LVDB row
directly. As future LVDB snapshots land, the default-path objects
update automatically; only the overrides need re-review against any
structural-paper updates.

Implementation: `src/client/local-group/local-group.ts`,
`src/client/local-group/local-group-loader.ts`,
`scripts/local-group/build-local-group.ts`,
`scripts/local-group/build-local-group-pure.ts`. Rendering walkthrough in
`src/client/local-group/README.md`.

## Local Group luminosity model

Each Local Group object carries an analytically-modelled luminous
volume calibrated so the integrated apparent V magnitude observed from
the camera matches the catalogue measurement from **any** camera
position, inside or outside the Local Group. The build pipeline solves
a per-object density normalisation (`density0`) offline and emits it in
`public/local-group.json`'s `emission` block; the renderer raymarches
the profile and never re-derives photometry.

**Profile families.** Two, assigned per object:

- **Sérsic spheroid** (120 objects: the LVDB dwarfs + SMC, Sagittarius
  dSph, M 32, NGC 205). The 3D density is the
  [Prugniel 1997](/data/papers/index.md#prugniel) deprojection ν(u) = ρ₀ · u^(−pₙ) · exp(−bₙ · u^(1/n)), with u the
  ellipsoidal radius in units of the R_e ellipsoid,
  pₙ = 1 − 0.6097/n + 0.05463/n²
  ([Lima Neto 1999](/data/papers/index.md#limaneto1999)'s refit
  of the 1 − 0.594/n + 0.055/n² in [Prugniel 1997](/data/papers/index.md#prugniel)), and bₙ = 2n − 1/3 + 4/(405n)
  ([Ciotti 1999](/data/papers/index.md#ciotti1999)). This projects to the observed 2D Sérsic law
  to ~1%; raymarching the 2D law as if it were 3D density is a
  deprojection error, visibly too shallow in the centre for n > 1.
  n comes from LVDB `n_sersic` where measured (43 objects, median
  0.83), else n = 1 — inside the observed population and the
  literature default for dSphs. A King-profile second family was
  rejected: only 9 further objects have King fits, and total flux is
  exact by solver construction regardless of profile shape.
- **Exponential thin disc, optional Sérsic bulge** (LMC, M31, M33):
  ρ(R, z) = ρ₀ · exp(−R/R_d) · exp(−|z|/z_d) in the disc frame the
  wireframe quaternion already defines. LMC R_d = 1.5 kpc, an
  exponential profile after
  [van der Marel 2001](/data/papers/index.md#vandermarel2001b), pure disc —
  bar and arms are below this detail tier. M31 R_d = 5.3 kpc with a
  spherical Sérsic bulge (R_e = 1.0 kpc, n = 2.2;
  [Courteau 2011](/data/papers/index.md#courteau2011)) carrying
  B/T = 0.31 of the V-band light; Courteau's bulge light fractions are
  21–29% of the IRAC 3.6 µm light, 29% for the 2D bulge + disc fit (Sect. 7)
  — a near-infrared split applied here in V. M33 R_d = 1.8 kpc
  ([Corbelli 2014](/data/papers/index.md#corbelli2014)), pure disc —
  Corbelli et al. find M33 hosts no bulge, reading its inner light as a
  raised mass-to-light ratio inside 1.5 kpc (p. 11), and its nuclear
  cluster is far below render scale. z_d = c_wireframe / 3 (the wireframe shell
  sits at 3 scale heights ≈ 95% of the vertical light). SMC stays a
  spheroid: no coherent disc; the line-of-sight elongation IS the
  structure.

**Geometry anchoring.** Default-path dwarfs use the wireframe
ellipsoid as the R_e ellipsoid directly — silhouette and glow share
one geometry source. Objects with structural overrides keep the
override's axis *ratios* but rescale so the sky-projected semi-major
half-light radius equals LVDB `rhalf_physical` — structure papers keep
the shape, LVDB photometry keeps the scale (SMC → R_e axes 813 / 1081
/ 1307 pc from the 3730 / 4960 / 6000 pc shell).

**Calibration.** Magnitudes map to zero-point-free flux numbers
F = 10^(−0.4·m). A raymarched column ∫ρ ds is surface brightness;
integrating over the object's solid angle gives total rendered flux
Φ = ∫ ρ(x)/s(x)² dV (s = camera→element distance), so 1/r² and
camera-anywhere behaviour are automatic by construction, with
far-field limit Φ = L/d². The solver requires the far-field flux at
the catalogue distance d₀ to reproduce the catalogue magnitude:

    ρ₀ = d₀² · 10^(−0.4·m_V) / G

where G is the geometry integral of the unit-ρ₀ profile over the
**actual truncated proxy-mesh volume**. Truncation compensation is
mandatory — an uncompensated 4·R_d disc envelope loses ~13% ≈ 0.15 mag,
beyond the ±0.1 mag render tolerance. Mesh envelopes: spheroids extend
to u_max = max(u₉₉(n), shell/R_e) (u₉₉ ≈ 4.6 at n = 1 — the radius
enclosing 99% of the light — and the mesh never sits inside the
wireframe silhouette); discs extend to max(4·R_d, wireframe a) in
plane and max(4·z_d, wireframe c) vertically, physical given observed
disc truncations at 4–5 R_d. M31's bulge and disc are solved
separately against B/T · F and (1 − B/T) · F, each over its own proxy
mesh — the bulge is a distinct spheroid volume (u ≤ u₉₉ sphere), not a
term clipped inside the disc envelope, so it reads as a bulge from
edge-on viewpoints too. One numeric quadrature path serves all profiles
(`src/client/hdr/emission/density0-solver-pure.ts`, shared with the Milky
Way band, which solves the same ρ₀ against an absolute magnitude);
`scripts/local-group/emission-geometry-pure.ts` supplies each family's
shape, and the analytic incomplete-gamma closed forms are vitest
cross-pins. The ±0.1 mag render tolerance sits inside
the catalogue's own ±0.2 mag median photometric uncertainty.

**The calibrated column field needs no display transform of its own.**
A column is flux per steradian by the normalisation above, so its
surface brightness is `26.5721 − 2.5·log10(column)` mag/arcsec² — a
derived zero point, and the layer's only one. The renderer hands that
to the scene-wide HDR unit like any other extended source
([§ 4](/docs/science-hdr-pipeline.md#4-per-layer-mapping--every-current-squash-and-its-replacement)).

An earlier revision gated the column against the star slider and
squashed it locally, on the reasoning that a linear map across the
bulge-to-disc-edge range would render every galaxy as a blown-out core
on a black disc. That reasoning does not survive the arithmetic. The
shared operator is extended Reinhard followed by an sRGB encode, and
the pair is already log-like over exactly this range: M31 spans ~8.7 mag
from bulge centre to disc envelope against the operator's `DR_MAG` of
7.5, resolving to ~0.68 / ~0.11 / ~0.003 of full scale at centre, disc
and envelope. The local squash was solving a problem the tone map
already solves, at the cost of two hand-tuned constants and a 4.1 mag
brightness error.

**Why an exponential disc does not look exponential.** Surface
brightness falls 1.0857 mag per scale length, so a profile that is
exponential in flux is *linear in magnitude* — and both the
dark-adapted eye and every astrophotography stretch work in roughly log
space. M31's R_d = 5.3 kpc subtends 23.4 arcmin on the major axis, so
the inner half-degree spans only ~1.4 mag: a gentle ramp, which is what
photographs show. Inclination sharpens it across the minor axis by
1/cos(77°) ≈ 4.4×, which is the visual asymmetry between the bright
ridge and its fast perpendicular falloff. A long-exposure image is not
a check on this — a typical processing chain histogram-stretches and
HDR-merges the core against the disc, which deliberately destroys the
radial photometry it would be checked against. Such an image *is* a
usable check on chromaticity when its colour calibration is
photometric.

**Photometry.** LVDB `apparent_magnitude_v` is 100% complete over the
121 dwarfs; M31 (m_V = 3.44) and M33 (m_V = 5.72) carry RC3 integrated
V ([de Vaucouleurs 1991](/data/papers/index.md#devaucouleurs1991)) in `overrides.tsv`. A definitional
consistency test pins ⟨μ⟩_e = m_V + 0.753 + 2.5·log₁₀(π·a·b) against
LVDB's `surface_brightness_rhalf` across the catalogue (median
deviation 0.008 mag).

<a id="no-dust"></a>**No dust.** LG objects sit far outside the MW dust slab; their
internal dust is below the photometric tolerance at this detail tier.
Catalogue m_V is as-observed (MW foreground extinction included), so
calibrating to it with no in-shader dust makes the Sol-region view
exact by construction. From extragalactic viewpoints the model keeps
as-observed brightness where the real object would shed its MW
foreground — a known, bounded bias (~0.1–0.2 mag for LMC/SMC/M31,
worst ~0.4 mag for Sgr behind the bulge), mostly inside catalogue
uncertainty. Dereddening and integrating MW dust per instance along
every ray would reintroduce exactly the machinery this decision
avoids, for an effect invisible at these surface brightnesses.

