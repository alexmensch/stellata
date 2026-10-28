# TSV — the one table reader and the artifact codecs

Every tab-separated table a TypeScript build step reads goes through this
folder: an external input through `readTable`, a file this repo writes itself
through its `defineArtifact` codec. Nothing else walks a TSV header or parses
a cell.

## Files in this area

```
scripts/util/tsv/
  table-pure.ts (+ test)      readTable / tableLineReader, TableRow and the
                              cell parsers (textCell, floatCell, intCell,
                              idCell, idListCell, sourceIdCell,
                              oneOfCell).
  artifact-pure.ts (+ test)   defineArtifact — a self-written table's codec.
  committed-round-trip.ts     Test support: describeCommittedRoundTrip, an
                              artifact's codec over its committed file, byte
                              for byte. Each folder that owns artifacts
                              calls it once per artifact.
```

## Reading a table

`readTable(spec, text)` yields one `TableRow` per data row;
`tableLineReader(spec, onRow)` is the same walk fed a line at a time, for a
table too large to hold as one string
([Streaming a committed table](../../catalog/parse/README.md#streaming-a-committed-table)).
A `TableSpec` names the `file` (repo-relative, and the label every error
carries), the `columns` the reader needs, and the `hint` an error prints:
the target that rebuilds or re-pulls the file.

- **The column index is typed.** A row is read by column name —
  `row.float('plx_mas')` — and the name must be one the spec lists, so a typo
  is a compile error rather than a column that silently reads empty.
- **The header resolves by name, in any order**, and a missing column throws.
  So does an empty or headerless file: every input is committed, usually LFS,
  and zero rows means truncated or unsmudged, never an empty dataset. A valid
  header with no rows yields no rows. Blank lines before the header are
  skipped; a line-fed reader calls `finish()` at the end, which throws when
  no header ever arrived.
- **`comments: true` skips every line whose first cell starts with `#`**,
  before or after the header — a hand-curated file's own commentary. The line
  numbers errors name stay physical: the reader is fed every line and counts
  each, so no caller filters lines before handing them over.
- **Absent and malformed are different states.** `text`, `float` and `int`
  answer null for an empty cell and throw — naming file, line and column — on
  a non-empty cell they cannot parse. `float` takes only a plain decimal
  (`12abc`, `nan`, `Infinity` and hex all throw); `int` only a safe integer
  (`12.0` throws). A cell past the end of a short row reads as empty.
- **An identifier reads only as the text it writes back to.** `id` (and
  `requiredId`, `idList(column, separator)`) take bare digits as written — no
  sign, padding or leading zero, within the safe-integer range — so a
  catalogue number or sid that parses is one its codec re-encodes byte for
  byte.
  `sourceId` takes bare digits only and answers a string, since a DR3
  source_id exceeds `Number.MAX_SAFE_INTEGER`; `requiredSourceId` also throws
  on an empty cell. `compareSourceIds` is the one order over them: absent
  first, then by `BigInt` value.
  `oneOf(column, values)` returns the cell typed to a closed set or throws.
- `raw` is the cell exactly as written, for a reader whose meaning depends on
  untrimmed text; `cells()` is every spec column's `raw` cell as one record.
- **`optional` columns may be absent from the header.** An absent one reads as
  empty in every row; `row.has(column)` says whether the header carried it,
  for the reader that must tell a missing column from an empty cell.

The bare cell parsers serve the frozen regression corpora, which address
records through `../../catalog/parse/corpus-tsv.ts`'s record refs.

## Artifact codecs

`defineArtifact({file, columns, hint, order, decode, encode})` is a table
this repo writes. The artifact constant is both what its writer serializes
through and what every reader imports, so the column roster, its encoding
and its parse each have one owner.

- **The header must equal `columns` byte for byte, and every row carry exactly
  that many cells.** The serializer writes the header, so a header that merely
  parses was never shipped.
- `serialize(records)` is the only writer. It refuses a cell holding a tab or
  newline, orders the rows (`by-line` sorts the encoded lines, a comparator
  sorts the records, `as-given` keeps the caller's order) and ends with a
  newline.
- `parse`, `rows` (a generator) and `lineReader` decode through the one
  `decode`. The decoded record is typed: a closed column decodes through
  `oneOf`, so an unknown value fails at the read rather than downstream.
- Each artifact constant lives in a leaf module that only its readers and its
  writer import ([The step table](../../pipeline/README.md#the-step-table--stepsts),
  "Reachable must mean read").
