# Cross-cutting docs

Genuinely cross-cutting documentation that doesn't belong to a single
subsystem folder. New docs default to *find the right folder and put
a README.md there*; only land in `docs/` if the topic truly spans the
whole codebase.

```
authoring-patterns.md   Write-time consistency rules (lifecycle pairing,
                        sibling symmetry, sentinel-init dirty-track,
                        single source of truth for time / camera state).
                        Each rule is the codified version of a
                        retrospective code-review finding. Read before
                        adding a bus.on() call, a sibling helper, a
                        sentinel-init dirty-track pattern, or any state
                        struct shifted mid-animation.
extragalactic-roadmap.md  Design gate for the extragalactic deep-field
                        epic: per-tier data inventory (Local Volume →
                        CMB), cosmology bake, manifest schema, naming
                        policy, morphology palette, selection-bias
                        handling. Spans scripts/, data/, and the
                        future src/client/extragalactic/.
sid.md                  Design gate for the Stellata ID epic:
                        three-layer identity model, designation
                        namespaces, append-only SID ledger + CI guard,
                        Gaia DR-reconciliation procedure with measured
                        DR2→DR3 churn, v4 URL wire + exact legacy
                        migration table. Spans scripts/, data/sid/,
                        url-state, and every object-carrying layer.
molecular-clouds.md     Physics model + implementation design for the
                        molecular-cloud epic (extinction calibration,
                        density profiles, substructure noise, cavities,
                        taxonomy, presence pass). Drives phases A.2–A.7;
                        spans scripts/clouds, scripts/dust,
                        star-pipeline, and molecular-clouds folders.
pipeline-flowchart.md   Mermaid flowchart of the full build pipeline:
                        external sources → binary cross-match →
                        catalog build → runtime binaries → parallel
                        layers → validation → client. Spans
                        scripts/catalog, scripts/binaries, data/, and
                        every other build script folder.
ux-tweaks.md            Reference table of UX knobs (orbit feel,
                        chevron density, focus-ring size, panel
                        defaults, etc.) and where to find them. Look
                        here when the user asks for a tweak.
science-catalog-ingestion.md   Split out of SCIENCE.md: AT-HYG/Gaia/
                        Hipparcos merge, Bailer-Jones + LMC-kinematic
                        distance overrides, driver astrometry,
                        current-epoch space-motion propagation.
science-stellar-modelling.md   Split out of SCIENCE.md: physical
                        radius, brightness/size perception model,
                        colour temperature routing + Teff calibration,
                        variable-star pulsation.
science-solar-system.md        Split out of SCIENCE.md: planet
                        rendering, phase functions, heliopause
                        boundary.
science-local-group.md         Split out of SCIENCE.md: wireframe
                        layer + per-object luminosity/density model
                        for the volumetric emission raymarch.
science-galactic-structure.md  Split out of SCIENCE.md: galactic
                        coordinate frame, Milky Way density profiles,
                        interstellar dust extinction, constellation
                        stick figures.
science-multiple-star-pipeline.md  Split out of SCIENCE.md:
                        binary/multiple detection philosophy,
                        blend-split math, worked examples.
screenshots/            Marketing + README hero images.
```

For project conventions and the top-level folder layout, see
[`CLAUDE.md`](../CLAUDE.md). For science / data / formula citations,
see [`SCIENCE.md`](../SCIENCE.md).
