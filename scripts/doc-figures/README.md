# Doc figures — counts quoted in docs, generated from the snapshots

A count a build pins in a committed `*-expected.json` snapshot has one owner:
that file. A doc that quotes the count wraps it in a marker, and
`pnpm run docs:figures` rewrites every marked figure from the snapshots.
`tests/doc-figures.test.ts` fails when a marker names a value no snapshot has,
or when a marked figure disagrees with its snapshot.

## Files

```
doc-figures-pure.ts        Marker grammar, key resolution, formatting, and
                           renderFigures (text + snapshots → rewritten text,
                           stale figures, problems). No I/O.
doc-figures-pure.test.ts   Grammar, resolution and format cases.
doc-figures.ts             loadSnapshots (every tracked *-expected.json, keyed
                           by stem; a repeated stem throws) and docFiles (tracked
                           and untracked-but-not-ignored *.md, symlinks out).
rewrite-doc-figures.ts     pnpm run docs:figures. Rewrites stale figures in
                           place; a file with a problem is left unwritten and
                           the run exits 1.
```

## The marker

```
the manifest holds <!-- count:membership-manifest/rows -->975,573<!-- /count --> rows
```

- **Key** — the snapshot's stem (`membership-manifest` for
  `scripts/catalog/membership/membership-manifest-expected.json`), a `/`,
  then the JSON path, dot-separated
  (`membership-manifest/additionsByReason.admitted:hd_omitted`). The value
  must be a number.
- **Format** — optional, after the key: none quotes the exact value with
  thousands separators; `sigN` rounds to N significant figures (`sig2`:
  2,635 → 2,600); `kN` rounds thousands to N significant figures and
  appends `k` (`k3`: 16,414 → 16.4k). Words around a rounded figure —
  "about", "~" — sit outside the marker.
- **One line** — the figure never wraps, and markers never nest.

HTML comments render as nothing on GitHub, in table cells too. Inside a fenced
block or a mermaid diagram they render literally, so a figure there stays
unmarked.

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

One value per marker. A figure computed from several values — a difference, a
sum, a percentage, "X of Y" where Y is not itself pinned — stays prose, and the
pinned values inside the sentence carry their own markers. Nothing checks an
unmarked number: equal numbers are mostly coincidences (a year, a catalogue
number, a unit conversion), so a scan for them would fail on noise that moves
with every snapshot regeneration.

**After regenerating a snapshot** (`UPDATE_BUILD_COUNTS=1`), run
`pnpm run docs:figures` and commit the doc changes with it. The run prints each
figure it moved; a moved figure in a sentence whose reasoning depended on the
old value still needs a reader.
