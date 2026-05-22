# Research artefacts

Pinned research deliverables — long-form investigations, calibration
runs, and the supporting code / data that produced them. Each
sub-folder is one investigation, frozen at the date the finding was
recorded; the folder's `README.md` is the published write-up.

These are NOT part of the build. Scripts here are exploratory by
nature, may pin versions outside the main `requirements*.txt`, and
won't necessarily run cleanly against a future state of the
repository. Treat each sub-folder's contents as a snapshot
referenced from the recommendation.

```
star-spectral-rendition/   Findings + recommendation for the star-
                           colour shader pass — B–V piecewise gradient
                           vs blackbody-LUT vs Apsis-aware tiering.
                           See its README for the TL;DR and Tier 1 /
                           Tier 2 implementation plan.
```

## Adding a new investigation

1. Create a sub-folder named for the topic (kebab-case).
2. Land the write-up as `README.md` at the top of that folder —
   first heading is the topic title.
3. Co-locate any reproducible scripts, sampled data tables, and
   plot images. Pin a `requirements.txt` if Python deps differ
   from the rest of the repo.
4. Link back to the originating bead / PR / docs section from
   the write-up itself, not from this index.
