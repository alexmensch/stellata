# Local Group — wireframes & luminosity model

Split out of `SCIENCE.md`. Covers the Local Group wireframe layer
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

**Primary catalogue**: Pace et al. 2024, *Local Volume Database*, Open
Journal of Astrophysics, arXiv:2411.07424 (CC0). A frozen snapshot of
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
  135° (van der Marel & Kallivayalil 2014, *ApJ* 781, 121,
  DOI 10.1088/0004-637X/781/2/121; distance Pietrzyński et al. 2019,
  *Nature* 567, 200, DOI 10.1038/s41586-019-0999-4). Scale length 4.5
  kpc, scale height 1 kpc.
- **SMC (62.81 kpc)**: triaxial 1 : 1.33 : 1.61 with the longest axis
  along line of sight (Subramanian & Subramaniam 2012, *ApJ* 744, 128,
  DOI 10.1088/0004-637X/744/2/128; distance from LVDB's SMC row,
  µ = 18.99 ± 0.1 — Cioni et al. 2000, *A&A* 359, 601, DENIS TRGB.
  Graczyk et al. 2020's eclipsing-binary result is 62.44 kpc,
  µ = 18.977; LVDB pins Cioni and the two agree well within its
  ±0.1 mag uncertainty). Resulting semi-axes 3.73 / 4.96 / 6.0 kpc.
- **Sagittarius dSph (26.3 kpc)**: 3D axis allocation — LVDB's
  projected ellipticity captures the sky-plane shape but not the
  line-of-sight extent (Ibata et al. 1995, *AJ* 110, 632,
  DOI 10.1086/192237).
- **M 32 (~773 kpc)**: optical-extent ellipsoid 1.6 / 1.2 / 1.2 kpc
  at PA 159°. LVDB's half-light radius of 105 pc renders sub-pixel
  at LG distances; the override uses the broader optical/D₂₅ extent
  cited in McConnachie 2012, *AJ* 144, 4
  (DOI 10.1088/0004-6256/144/1/4).
- **NGC 205 / M 110 (~835 kpc)**: 2.7 / 1.5 / 1.5 kpc at PA 170° from
  the same McConnachie 2012 review — again the optical extent rather
  than the small half-light radius.
- **M31 / Andromeda (776 kpc)**: inclined disc at i = 77°, line of
  nodes PA = 37°, 15 kpc disc radius × 500 pc thickness — the
  structural parameters from the PAndAS survey (McConnachie et al.
  2018, *ApJ* 868, 55, DOI 10.3847/1538-4357/aae8e7). Standalone row
  (not in LVDB's `dwarf_all` table; the override carries RA, Dec,
  distance directly).
- **M33 / Triangulum (840 kpc)**: inclined disc at i = 54°, line of
  nodes PA = 22°, 8.5 kpc disc radius × 400 pc thickness — distance
  from the Cepheid measurement of Bonanos et al. 2006, *ApJ* 652, 313
  (DOI 10.1086/508140). Standalone row.

Per the build's data-freshness policy (`scripts/README.md`
§ Frozen external data), refreshing the LVDB snapshot is an explicit
manual step (curl + `pnpm run build:local-group --force`) — `pnpm run
build` never touches the network.

Per the data-fidelity principle (`SCIENCE.md` § Scope principles), hand-curated overrides are
the exception, reserved for objects with well-studied departures that
no canonical structural row resolves — or, in the case of M31 / M33,
for the major spirals that the LVDB `dwarf_all` table excludes by
construction. Other Local Volume dwarfs render from their LVDB row
directly. As future LVDB snapshots land, the default-path objects
update automatically; only the overrides need re-review against any
structural-paper updates.

Implementation: `src/client/local-group.ts`,
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
  dSph, M 32, NGC 205). The 3D density is the Prugniel–Simien
  deprojection ν(u) = ρ₀ · u^(−pₙ) · exp(−bₙ · u^(1/n)), with u the
  ellipsoidal radius in units of the R_e ellipsoid,
  pₙ = 1 − 0.6097/n + 0.05463/n², and bₙ = 2n − 1/3 + 4/(405n)
  (Ciotti & Bertin 1999). This projects to the observed 2D Sérsic law
  to ~1%; raymarching the 2D law as if it were 3D density is a
  deprojection error, visibly too shallow in the centre for n > 1.
  n comes from LVDB `n_sersic` where measured (43 objects, median
  0.83), else n = 1 — inside the observed population and the
  literature default for dSphs. A King-profile second family was
  rejected: only 9 further objects have King fits, and total flux is
  exact by solver construction regardless of profile shape.
- **Exponential thin disc, optional Sérsic bulge** (LMC, M31, M33):
  ρ(R, z) = ρ₀ · exp(−R/R_d) · exp(−|z|/z_d) in the disc frame the
  wireframe quaternion already defines. LMC R_d = 1.5 kpc (van der
  Marel & Cioni 2001, *AJ* 122, 1807, DOI 10.1086/323099), pure disc —
  bar and arms are below this detail tier. M31 R_d = 5.3 kpc with a
  spherical Sérsic bulge (R_e = 1.0 kpc, n = 2.2, B/T = 0.31; Courteau
  et al. 2011, *ApJ* 739, 20, DOI 10.1088/0004-637X/739/1/20). M33
  R_d = 1.8 kpc (Corbelli et al. 2014, *A&A* 572, A23,
  DOI 10.1051/0004-6361/201424033), pure disc — B/T ≲ 0.04 and the
  "bulge" is a nuclear cluster far below render scale, costing
  < 0.05 mag on the total. z_d = c_wireframe / 3 (the wireframe shell
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
separately against B/T · F and (1 − B/T) · F. The solver
(`scripts/local-group/emission-solver-pure.ts`) uses one numeric
quadrature path for all profiles; the analytic incomplete-gamma closed
forms are vitest cross-pins. The ±0.1 mag render tolerance sits inside
the catalogue's own ±0.2 mag median photometric uncertainty.

**Photometry.** LVDB `apparent_magnitude_v` is 100% complete over the
121 dwarfs; M31 (m_V = 3.44) and M33 (m_V = 5.72) carry RC3 integrated
V (de Vaucouleurs et al. 1991) in `overrides.tsv`. A definitional
consistency test pins ⟨μ⟩_e = m_V + 0.753 + 2.5·log₁₀(π·a·b) against
LVDB's `surface_brightness_rhalf` across the catalogue (median
deviation 0.008 mag).

**No dust.** LG objects sit far outside the MW dust slab; their
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

