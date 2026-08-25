# Cross-cutting docs

Genuinely cross-cutting documentation that doesn't belong to a single
subsystem folder. New docs default to *find the right folder and put
a README.md there*; only land in `docs/` if the topic truly spans the
whole codebase.

```
architecture-modularity.md  Design gate for the object-kind modularity
                        epic: engine services / kind modules /
                        population shards, the ObjectKindModule +
                        KindContext contracts, FocusTarget-into-
                        FocusableProvider merge, facade flattening,
                        free-fly engine constraints, phasing. Spans
                        src/client/ end to end.
authoring-patterns.md   Write-time consistency rules (lifecycle pairing,
                        sibling symmetry, sentinel-init dirty-track,
                        single source of truth for time / camera state).
                        Each rule is the codified version of a
                        retrospective code-review finding. Read before
                        adding a bus.on() call, a sibling helper, a
                        sentinel-init dirty-track pattern, or any state
                        struct shifted mid-animation.
bd-workflow.md          Long-form bd procedures that fire on a trigger
                        rather than in every session: memory + bead
                        grooming passes, the bug-sweep handoff format,
                        and label/metadata/external-ref conventions.
                        Reached from the stellata-beads skill, which
                        carries the everyday bd facts.
extragalactic-roadmap.md  Design gate for the extragalactic deep-field
                        epic: per-tier data inventory (Local Volume →
                        CMB), cosmology bake, manifest schema, naming
                        policy, morphology palette, selection-bias
                        handling. Spans scripts/, data/, and the
                        future src/client/extragalactic/.
catalog-driver.md       DURABLE CONTRACT for how membership,
                        identifiers, and per-field values are sourced
                        once AT-HYG is retired as the driver — read it
                        before designing anything in that space:
                        Gaia-native membership (inherited spine +
                        magnitude floor), frozen-CDS classic-ID label
                        overlay, HD→Gaia join route, bright / no-Gaia
                        rescue tiers, record-parity contract, SID
                        migration policy. Spans scripts/catalog/,
                        scripts/refresh/, data/, url-state, and the
                        SID ledger.
star-naming.md          Design gate for the naming-authority epic:
                        the IAU WGSN authority ladder, canonical
                        designation forms + their normalisers, the
                        derive-vs-ship alias model, glyph policy, the
                        SID-keyed curation seam, naming parity gate.
                        Spans scripts/catalog/, data/, typeahead,
                        chart-mode and the focus card.
sid.md                  Design gate for the Stellata ID epic:
                        three-layer identity model, designation
                        namespaces, append-only SID ledger + CI guard,
                        Gaia DR-reconciliation procedure with measured
                        DR2→DR3 churn, v4 URL wire + exact legacy
                        migration table. Spans scripts/, data/sid/,
                        url-state, and every object-carrying layer.
pipeline-flowchart.md   Plain-language flowchart + walkthrough of the
                        full data pipeline: which published datasets
                        feed it, the decisions each build stage makes,
                        and what the viewer loads. Written for readers
                        who know the data sources, not the codebase —
                        no file paths or script names. Implementation
                        detail lives in each build folder's README.
ux-tweaks.md            Reference table of UX knobs (orbit feel,
                        chevron density, focus-ring size, panel
                        defaults, etc.) and where to find them. Look
                        here when the user asks for a tweak.
science-hdr-pipeline.md Design gate for the HDR epic: the
                        threshold-anchored luminance unit, extended-
                        Reinhard tone-map + white point, exposure/epoch
                        model, the global-operator rule (spatial variation
                        upstream of the operator only — local tone mapping
                        decided out), per-layer squash replacements,
                        chart-mode bypass, float-RT fallback.
                        Drives xypg H2–H8;
                        spans star-pipeline, milkyway, solar-system,
                        local-group, chart-mode and the future
                        src/client/hdr/.
science-catalog-ingestion.md   Split out of SCIENCE.md: AT-HYG/Gaia/
                        Hipparcos merge, Bailer-Jones + LMC-kinematic
                        distance overrides, driver astrometry,
                        current-epoch space-motion propagation. Its
                        AT-HYG-framed sections are superseded by
                        catalog-driver.md; it says which and why.
science-stellar-modelling.md   Split out of SCIENCE.md: physical
                        radius, brightness/size perception model,
                        colour temperature routing + Teff calibration,
                        variable-star pulsation.
science-solar-system.md        Split out of SCIENCE.md: planet
                        rendering, phase functions, naked-eye colour
                        calibration (solar reference white), atmosphere
                        shells + their per-body optical-depth sources,
                        heliopause boundary.
science-local-group.md         Split out of SCIENCE.md: wireframe
                        layer + per-object luminosity/density model
                        for the volumetric emission raymarch.
science-galactic-structure.md  Split out of SCIENCE.md: galactic
                        coordinate frame, Milky Way density profiles,
                        interstellar dust extinction, constellation
                        stick figures.
science-molecular-clouds.md    Extinction units chain, calibrated Zucker
                        density model, taxonomy + embedded-star cavities,
                        isosurface-traced presence pass, anti-aliasing
                        rules.
science-multiple-star-pipeline.md  Split out of SCIENCE.md:
                        binary/multiple detection philosophy,
                        blend-split math, worked examples.
screenshots/            Marketing + README hero images.
```

For project conventions and the top-level folder layout, see
[`CLAUDE.md`](../CLAUDE.md). For science / data / formula citations,
see [`SCIENCE.md`](../SCIENCE.md).
