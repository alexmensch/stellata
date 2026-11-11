# Doc figures — counts and measured figures quoted in docs, generated from the snapshots

A count a build pins in a committed `*-expected.json` snapshot has one owner:
that file — and so does a figure a test measures and pins through
[`figurePins`](#measured-figures--a-tests-pins-as-a-snapshot). A doc that
quotes either wraps it in a marker, and `pnpm run docs:figures` rewrites
every marked figure from the snapshots.
`tests/doc-figures.test.ts` fails when a marker names a value no snapshot has,
or when a marked figure disagrees with its snapshot.

## Files

```
doc-figures-pure.ts        Marker grammar, code masking, key resolution,
                           formatting, and renderFigures (text + snapshots +
                           doc kind → rewritten text, stale figures, problems);
                           the catalogue-size matcher and the exemption
                           parser; the staged-copy detector. No I/O.
doc-figures-pure.test.ts   Grammar, masking, resolution, format and size-scan
                           cases.
catalogue-size-exemptions.txt
                           The size scan's shrink-only exemption list.
doc-figures.ts             loadSnapshots (every *-expected.json, keyed by stem,
                           a staged one flattened so a count's path skips its
                           stage — ../util/counts/count-stages-pure.ts; a repeated
                           stem throws) and docFiles (every *.md).
                           Both take tracked and untracked-but-not-ignored
                           files, so a snapshot just written by
                           UPDATE_SNAPSHOTS=1 resolves before its git add,
                           and both list through presentFiles, so a symlink or
                           a deleted, unstaged file is skipped. docFiles takes
                           *.html too (src/client/app/index.html). scanDocFigures
                           renders every doc against the snapshots — the one
                           scan the rewrite and tests/doc-figures.test.ts share;
                           scanCatalogueSize is the size scan below.
doc-figures.test.ts        Both listings over a throwaway repo.
check-staged-figures.ts    The commit-time copy check (below): prints each
                           unmarked snapshot copy on a staged added line and
                           exits 1. Run by commit-sweep-guard.sh.
figure-pins.ts             figurePins: a test's measured figures asserted
                           against its snapshot, or recorded and written
                           under UPDATE_SNAPSHOTS=1 (below).
figure-pins.test.ts        Tolerance, malformed snapshot, missing key,
                           double pin, unpinned keys, update-mode write.
rewrite-doc-figures.ts     pnpm run docs:figures. Rewrites stale figures in
                           place; a file with a problem is left unwritten and
                           the run exits 1.
```

## The marker

```
<!-- count:<stem>/<json.path>[ sigN|kN|dN] -->FIGURE<!-- /count -->
the manifest holds <!-- count:membership-manifest/rows -->975,573<!-- /count --> rows
```

- **Key** — the snapshot's stem (`membership-manifest` for
  `scripts/catalog/membership/membership-manifest-expected.json`), a `/`,
  then the JSON path, dot-separated
  (`membership-manifest/additionsByReason.admitted:hd_omitted`). A key that
  itself holds dots, a reason code, is one step of the path: each step takes
  the longest run of segments that is a key there
  (`build-catalog/brightness-colour.v.gliese`). The value must be a number.
- **Format** — optional, after the key: none quotes the exact value with
  thousands separators; `sigN` rounds to N significant figures (`sig2`:
  2,635 → 2,600); `kN` rounds thousands to N significant figures and
  appends `k` (`k3`: 16,414 → 16.4k); `dN` fixes N decimal places, trailing
  zeros and sign kept (`d3`: 0.38995 → 0.390, `d2`: −1.0671 → -1.07), for a
  measured magnitude rather than a count. Words around a rounded figure —
  "about", "~" — sit outside the marker.
- **One line** — the figure never wraps, and markers never nest.

HTML comments render as nothing on GitHub, in table cells too. Inside a code
block, inline code or a mermaid diagram they render literally, so the scan
skips markdown code entirely (`maskCode`, over the same `marked` lexer the
doc-pointer suite uses) and a figure there stays unmarked — which is also how
the grammar line above can show placeholders.

## The catalogue's size

`build-catalog/recordCount` owns it; the build fails when its counts disagree
with the snapshot, so it is the shipped catalogue's size. Three surfaces:

- **Markdown and HTML** quote it through a marker, usually `k2` (980k) or
  `sig2` (980,000).
- **`CITATION.cff`** cannot hold a marker (a YAML string), so
  `MARKERLESS_SURFACES` lets it quote the current `sig2` / `k2` rounding
  unmarked, and nothing else.
- **Code** never quotes it — a comment says "the full catalogue".

`scanCatalogueSize` enforces all three. It reads every tracked text file
(test fixtures, `research/` and the paper index excluded) for an unmarked
figure in the catalogue's size range — `inherited-spine/rows` less 5% up to
`recordCount` plus 5%, the smallest and largest the catalogue has been — on a
line about stars, records, instances, positions or the catalogue. Markdown code
is masked as for markers. A hit is an offender unless
`catalogue-size-exemptions.txt` lists its file and figure with a reason:
`stale` (prose reasons from an old size and awaits a rewrite), `history` (a
dated measurement) or `other-count` (an in-range figure counting something
else). An entry that no longer matches fails too, so the list only shrinks.

Past a million records `k2` renders "1,000k"; that surfaces in the rewrite's
output, and is the point to add a millions format.

## Measured figures — a test's pins as a snapshot

A figure a test computes from the shipped model (a sightline's surface
brightness, a calibration check's disagreement) moves whenever an input it
reads is re-measured. Written as a literal in both the test and the doc, it
has two owners and the doc copy goes stale silently. `figurePins(path)`
makes the snapshot the one owner:

- `pin(key, actual)` throws unless `actual` matches the snapshot's value to
  `FIGURE_PIN_RELATIVE_TOLERANCE` (1e-9 relative), far inside any digit a
  marker quotes, so no re-measure can move a quoted figure and pass; a key the
  snapshot lacks fails, naming the refresh. Rounding lives only in the
  marker's format.
- Under `UPDATE_SNAPSHOTS=1` it records instead, and `write()` (the suite's
  `afterAll`) rewrites the snapshot, keys sorted, full precision.
- The suite ends with a case asserting `unpinned()` is empty, so a pin
  removed from the test cannot leave its figure behind for a doc to quote.

After a re-measure fails the suite: `UPDATE_SNAPSHOTS=1 pnpm vitest run
<the test>`, then `pnpm run docs:figures`, and read every sentence whose
figure moved. One snapshot per test file, beside it:
`/tests/integration/milkyway-sightlines-expected.json` is the instance.

## What gets a marker

**Trigger: writing a number into any doc that a snapshot pins.** Mark it — the
exact value, or a rounded one with a format. Rounded prose without a marker is
only for a figure where any exact-looking value would mislead.

**A marker asserts the sentence stays true at any value the snapshot takes.**
So a figure tied to a date or a past build ("measured 2026-08-01", a column of
a build-comparison table) is history and stays unmarked, and so does a figure
whose sentence reasons from it: other unpinned numbers measured alongside it,
arithmetic on it (bytes = count × size), or a population the key does not
count. That prose is rewritten first, then marked.

**Prose never states a computed total beside its pinned parts** ("446 + 1,605
of 2,051"): each marked part is rewritten on its own and nothing checks the
relation, so the sentence breaks silently. State the parts only, or pin the
total as its own snapshot key — one build run then produces every figure.

One value per marker. A figure computed from several values — a difference, a
sum, a percentage, "X of Y" where Y is not itself pinned — stays prose, and the
pinned values inside the sentence carry their own markers.

**After regenerating a snapshot** (`UPDATE_SNAPSHOTS=1`), run
`pnpm run docs:figures` and commit the doc changes with it. The run prints each
figure it moved; a moved figure in a sentence whose reasoning depended on the
old value still needs a reader.

## Staged copies at commit time

No tree-wide test looks for unmarked copies: equal numbers are mostly
coincidences (a year, a catalogue number, 100 pc), and a whole-tree scan would
fail unrelated PRs on noise that moves with every snapshot regeneration. The
commit-time guard (`scripts/hooks/commit-sweep-guard.sh`, check (d)) reads only
the lines a commit adds to markdown, so a coincidence never re-fires and needs
no exception list. `check-staged-figures.ts` runs `unmarkedSnapshotCopies` over
each staged file, code masked and markers blanked, and flags a figure that
equals a snapshot leaf when either:

- it carries a thousands comma (`1,977`), or
- it is 100 or more and a matching key's leaf name sits within 3 lines.

Leaves inside an array are skipped: `build-distance-outliers` lists outlier
records, and their distances are not counts. On a replay of 400 main-line
commits this shape was right on 99% of 519 hits and interrupted 82 of the 385
that touched markdown, one or two for nothing. What it misses, by design:
comma-less counts under 1,000 with no key name nearby, rounded forms (the
catalogue's size aside, which [The catalogue's size](#the-catalogues-size) scans
tree-wide), and a copy already stale, which equals nothing. A hit that is
history, computed or a coincidence passes with `[figure-ok: <reason>]` in the
commit message. The guard runs only for commits made through Claude Code.
