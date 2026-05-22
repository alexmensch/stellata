# Local Group build

`build-local-group.ts` — LVDB `dwarf_all` snapshot + hand-curated
overrides → `public/local-group.json`. `build-local-group-pure.ts`
holds the pure helpers (RA/Dec→ICRS, orient → quaternion, override
merge, standalone-row builder, display-name + catalog-designation
rules, distance filter); vitest-pinned in `*.test.ts`.

See `src/client/local-group/README.md` for the runtime renderer, data
schema, and refresh protocol.
