# Molecular cloud build

`build-clouds.py` — Zucker 2020 Table A1 + Zucker 2021 Table 1 →
`public/clouds.json`. Z2021 entries take precedence over Z2020 for the
clouds both cover. Renderer is currently shelved at the runtime.

## Merge logic

- **Z2021 Table 1** → 12 ellipsoid clouds with axis-aligned bounding
  boxes in galactic Cartesian. The bbox is converted to centroid +
  semi-axes; the orientation `quat` is the `GAL_TO_ICRS` rotation so
  the ellipsoid local axes correctly point along galactic +X/+Y/+Z
  when scaled by the renderer.
- **Z2020 Table A1** → 84 sphere clouds (sightline-aggregated by name;
  sphere radius = max distance of any sightline from the centroid,
  with a 5 pc default for singletons and a 3 pc floor). `quat` =
  identity.
- **Precedence** — Z2021 entries override Z2020 for the clouds both
  cover (Chamaeleon, Ophiuchus, Lupus, Taurus, Perseus, Pipe, Cepheus,
  Corona Australis, Orion → A/B/λ split). Sub-regions like
  `Ophiuchus_Arc` / `Pipe_B59` stay separate Z2020 spheres.
