# IAU WGSN pull

`refresh:iau-wgsn`: the IAU WGSN naked-eye catalogue (`NEC.csv`) and the
faint approved names (`wgsnFaints.csv`), fetched over plain HTTP from the
WGSN chair's site and committed verbatim to `data/iau-wgsn/`. What the files
hold and how the build reads them: [data/iau-wgsn/README.md](/data/iau-wgsn/README.md).

## Files

- `iau-wgsn-pure.ts` — each file's URL, header, row band, named-row floor and
  spot rows; the gates over a file's text; the pull's description.
- `refresh-iau-wgsn.ts` — the entry: fetch each file (the TAP backend's
  `withRetry`: a 5xx or network failure retries, any other non-200 refuses),
  report its host, and emit both files at once once every gate passes.
  `iau-wgsn-outputs.ts`, its `declareOutputs`.
- `iau-wgsn.test.ts` — the gates over the committed files and over each way
  a release can fail them.

## The record

No TAP, so no checkpoint: the URLs are the whole query, and the host
(`exopla.net`) is the record's `answeredBy`. The header each file must start
with and the null spellings a `Name` may take are the naming parser's
(`NEC_HEADER`, `FAINTS_HEADER`, `NULL_SPELLINGS` in
`../../catalog/naming/wgsn-parse-pure.ts`), so the pull and the build agree on
both by construction. A byte-order mark is dropped; line endings are kept as
served. Follow a run that moves either file with `pnpm run build:wgsn`.
