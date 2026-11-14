# Stage 5 — physical or optical, in TypeScript

The TypeScript Stage 5 of the binaries pipeline: every `DecomposedPair` Stage 3
returned (`../astrometry/`) classified physical or optical, tagged with the tier
that decided, keyed by its pair; `../build-binaries.ts` calls it. What each
tier decides, its thresholds and why: [What each tier decides](#what-each-tier-decides).

## Files in this area

```
scripts/binaries/optical/
  optical-tiers-pure.ts (+ test)  OPTICAL_VIA_PROPERTIES (each tag, in
                                  cascade order, and whether it keeps the
                                  pair); the tier thresholds; each tier's
                                  test; classifyPairOptical, the cascade
                                  for one pair.
  pm-budget-pure.ts               orbitalPmBudgetKmS: the orbital motion a
                                  pair's components carry from the tighter
                                  sub-pairs of their system.
  attach-optical.ts (+ test)      attachStage5 (every pair's context, then
                                  the cascade), Stage5Result, opticalTally,
                                  stage5Counts, stage5Rates.
  stage5-report-pure.ts           The build-log lines, read off the result.
```

## The shape of a result

`Stage5Result.optical` maps each pair to one `OpticalVia` tag. Whether the pair
is kept is the tag's `physical` property in `OPTICAL_VIA_PROPERTIES`, never a
second field, so a verdict and its tag cannot disagree; Stage 6 drops the
pairs whose tag is not physical.

## What each pair is classified on

`attachStage5` gathers, per pair: its Stage 4 orbit route, its Stage 3
astrometry (the CPM tier reads the primary's proper motion and the
secondary's route), its system's parallax and proper-motion anchors
([System anchors](../astrometry/README.md#system-anchors)), its total mass,
and its orbital-PM budget. The masses are an input, computed once before the
stage (`../masses/`).

The parallax tiers (separation limit, both-Gaia, asymmetric) read each side's
own Gaia 5p row and HIP2 row from the identifier indices, not the route Stage
3 picked. Stage 3's HIP2 substitution for an orbit-perturbed Gaia proper
motion therefore does not reach the escape-velocity gate; whether it should is
`stellata-hhaw.45.17.13`, open.

## Counts

`stage5Counts` returns the twelve `optical_*` keys, one per tag, folded
through the one tally helper; `stage5Rates` derives `optical_rejected_rate`,
the rejecting tags over every classified pair, through `share`
(`no-denominator` when none was classified), which `stage5Report` logs,
`n/a` when absent. The keys are held to the committed count snapshot, as
Stage 4's are ([Counts](../orbits/README.md#counts)).

## Choices the outputs rest on

- **Constants come from `src/astro-core/`**: `AU_PER_PC` at full precision
  and `KM_S_PER_AU_YR` derived from the AU and the Julian year.
- **The budget walks the system's pairs in pair order**, summing in that
  order.

## What each tier decides

`optical-tiers-pure.ts` classifies each pair as physical or
optical and tags the decision with the tier that decided
(`OPTICAL_VIA`):

| Tier | Tag | Rule |
| --- | --- | --- |
| 1 | `wds_notes_kept` / `_rejected` | WDS Notes flag chars: `{T, V, Z}` keep, `{S, U, X, Y}` reject. Other chars silent — tier falls through. |
| 2 | `orbit_kept` | Stage 4 selected real orbital elements — every `ORBIT_VIA` member but `none` (gaia_nss, orb6, orb6_spectroscopic, msc). An empirical orbit fit is the strongest evidence of physical association and wins over every gate below, including the separation limit — a close pair's Gaia parallaxes are routinely blend-corrupted, so a few-pc parallax split does not beat a tracked relative orbit, and NSS orbits that could leak onto a genuinely wide (unbound) companion are already blocked upstream by Stage 4's separation-sanity gate. Needed for Sirius A-B (grade-2 ORB6 orbit past a 9.9-mag WD gap) and the nearby CPM pairs (η Cas, 61 Cyg, Struve 2398) whose orbital PM split would otherwise trip the velocity gate. |
| 3 | `sep_limit_rejected` | The pair's two components sit more than the physical bound-pair limit apart in 3D (`SEPARATION_LIMIT_PC = 1.0`) — a line-of-sight optical double. Each component's distance is its own parallax (Gaia or HIP2), or the system parallax anchor when it has none; the on-sky term is the WDS ρ at the reference distance, the radial term the parallax-derived depth gap counted only when significant (`RADIAL_SEPARATION_SIGMA = 3.0` of the combined error). Fires off a well-measured own parallax (`SEPARATION_POE_MIN = 5.0`). Pollux F: own ~297 pc vs its partner's inherited ~10.4 pc. |
| 4 | `gaia_kept` / `_rejected` | Both components carry a Gaia 5p row. A 3σ parallax disagreement on combined error (`BOTH_GAIA_PLX_GATE_SIGMA = 3.0`) rejects only when the implied 3D separation also exceeds the physical limit — the same guard as tier 5, so a close visual pair's blend-corrupted Gaia parallaxes can't split a within-limit pair. A within-limit disagreement (and an agreement) falls to the escape-velocity sub-gate, which rejects a transverse velocity too large to be bound — `v_transverse > ESCAPE_VELOCITY_SAFETY_FACTOR (2.5) × sqrt(2·G·M/r)`. `v_transverse` is from the PM difference (a lower bound on v_rel, so the gate can only reject); `M` is the pair's spectral-table mass (`pairMasses`, generous default when unknown); `r` is the same projected+radial separation. Replaces the old 5 mas/yr per-axis PM cut, which mistook a nearby bound pair's real orbital PM split for optical contamination. A component hosting a tighter resolved sub-pair carries orbital motion in its catalog PM, so the reject threshold is raised by an **orbital-PM budget** — Σ v_circ(M_sub, r_sub) over the tighter pairs either component participates in (r from the sub-pair's elements `a_AU`, else measured ρ×d, else a 10 AU floor cap; sub-pairs with P under ~2× the Gaia baseline contribute nothing — the 5p fit averages their wobble). The budget applies ONLY when the pair's parallaxes POSITIVELY establish 3D collocation (Δd + 2σ inside the tidal limit): 22039-2451 AC at 47 pc qualifies and re-keeps; AR Cas AF/AG at 203 pc have pc-scale depth uncertainty, get no budget, and their correct unbound-association rejections stand. |
| 5 | `asymm_kept` / `_rejected` | Exactly one component has a Gaia 5p row; the other has a HIP2 parallax anchor (Gaia-saturated bright primary). Gaia parallax vs HIP2 anchor at 3σ combined error (`ASYMM_PLX_GATE_SIGMA = 3.0`), rejecting only when the implied 3D separation also exceeds the physical limit — a HIP2-vs-Gaia zero-point offset can't split a bound pair. Backstop for a poe < 5 Gaia parallax; the well-measured Sirius A-C/D/E/F-shaped splits (anchor 378 mas vs Gaia <1 mas → a ~kpc split) reject upstream at tier 3, so this tier rejects nothing in the current corpus. |
| 6a | `cpm_baseline_kept` / `_rejected` | WDS epoch-baseline common-proper-motion test, only for pairs whose secondary carries no independent parallax (`astrometry_via` ∈ {`unresolved`, `athyg_position`} at Stage 5) — the population tiers 3–5 never cross-checked in 3D. A bound companion shares the primary's space motion, so its relative sep/PA is near-stable from `date_first` to `date_last`; a background star is sky-static and drifts by ≈ \|PM_primary\| × Δt. Rejects when the observed tangent-plane drift ≥ `CPM_DRIFT_REJECT_FRACTION (0.5)` × predicted slip; keeps when within the `CPM_DRIFT_KEEP_FLOOR_ARCSEC (2.0)` measurement floor; in between falls through. Gated on predicted slip ≥ `CPM_SLIP_MIN_ARCSEC (10.0)` so low-PM primaries — and the ~10k legitimate faint wide companions the `athyg_position` route exists to render — fall through unchanged. A primary with no own PM (an identity-less letter riding the Stage-6 system anchor) borrows the system PM anchor (`systemPmAnchors`) — the pair's membership claim places it at the anchor, so the anchor's motion is the slip a background secondary would show. Canonical reject: 61 Cyg AH, a historical background star the system's 5.2″/yr PM slid past. |
| 6 | `mag_heuristic_kept` / `_rejected` | Backstop. `|Δmag| ≤ 5` keep, otherwise reject. Used only when no other tier fired (typically Tycho-only systems where neither component has Gaia astrometry). Pairs with no usable mags either are kept on the absence-of-evidence-is-not-evidence-of-optical principle. |

Two physical-boundness criteria underpin tiers 3–4, both mechanical:

- **Separation limit (tier 3).** Bound stellar pairs can't exceed the
  Galactic tidal-disruption limit for field binaries (~1 pc); a wider 3D
  separation is a line-of-sight optical double. The gate compares the
  pair's own two components against each other (not a cross-pair anchor),
  so a real inner binary of an optically-projected member — both
  components at the same true distance — is kept. Radial separation is
  counted only when the parallax difference clears the combined-error
  threshold, which keeps a HIP2-vs-Gaia systematic (AU Mic B/C's 0.89 pc
  apparent gap) from splitting a bound pair.
- **Escape velocity (tier 4/5).** A bound pair needs `v_rel < sqrt(2·G·M/r)`.
  Only the transverse component is measurable (Δpm × distance), so the
  gate is a lower bound and can only reject. Masses come from
  `../masses/` spectral estimates (~2× uncertain ⇒ ~1.4× on
  v_escape), so the 2.5× safety factor keeps genuine orbital motion
  (v_transverse < v_escape) from tripping it — η Cas AB: v_transverse
  ≈ 2.9 km/s vs v_escape ≈ 8 km/s, kept.

The separation and CPM tiers read each system's first measured parallax
and proper motion, the same first-resolved-per-system anchors Stage 4's NSS
separation gate reads
([System anchors](../astrometry/README.md#system-anchors)). The escape-velocity
gate's pair masses are computed once before the stage (`masses/`).

The cascade short-circuits — once a tier produces a verdict the lower
tiers don't run. Stage 6 drops pairs classified as optical entirely; the
multiples.tsv emit never sees them. (The exception is the standalone
augmentation pass, which can still emit a SIMBAD-known component whose
parent pair was dropped — see Stage 6.) The separation-limit and
escape-velocity gates depend on the full Gaia DR3 astrometry pull being
current — see [`data/gaia/README.md`](../../../data/gaia/README.md) for the
refresh ordering (`build:astrometry-request` regenerates the request list,
then `refresh:gaia-astrometry` re-pulls before the next build).
