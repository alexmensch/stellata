# Reason codes — closed, append-only, generated

Every lineage row's `code` comes from one list: each stage declares its
codes, and `data/lineage/reason-codes.tsv` is generated from those
declarations. The row contract the codes sit in is [../README.md](../README.md#row-contract).

## Files in this area

```
scripts/catalog/lineage/reason-codes/
  reason-codes-pure.ts           stageCodes: a stage's codes, its live ones
                                 typed apart (`liveCode` looks one up as a
                                 count-block key), with their
                                 effect, role and status; outcomeCode and
                                 refusalCode, the two declaration shapes;
                                 retired, a retired code's status.
  reason-code-list-pure.ts       reasonCodeList, the generated list, and
                                 appendOnlyViolations.
  reason-codes-tsv.ts            REASON_CODES, the list's codec;
                                 parseListedCodes, an older copy read by
                                 its own header.
  reason-codes-outputs.ts        REASON_CODES_OUTPUTS, the generator's
                                 output declaration.
  generate-reason-codes.ts       `pnpm run lineage:codes`, over
                                 ../lineage-stages.ts.
  reason-codes.test.ts           The list equals its generation, and is
                                 append-only against the merge-base.
```

## The rules

- One code per outcome-producing branch: two records with one code were
  decided for the same reason by the same code path. Per-instance detail goes
  in `params`, never the code.
- Each stage declares its codes in its own module as `stage.rule-branch`
  (`stageCodes`), and `../lineage-stages.ts` lists every stage. The committed
  code list, `data/lineage/reason-codes.tsv`, is generated from those
  declarations by `pnpm run lineage:codes` and checked by CI
  (`reason-codes.test.ts`), never hand-edited.
- A Python stage, with no compiler to force the mapping, declares its codes
  in a small data file beside it that the generator also reads, and a
  Python test checks that every outcome value it can emit maps to a row.
- An entry carries the code, its stage, its declared effect (removal and
  re-bind codes: retire, park or merge; `none` for every other code), its
  role — `outcome`, or `refused` for an alternative the stage weighed and
  rejected (`refusalCode`, whose effect is always `none`) — a
  one-line description, `first_version` — the release current when the code
  was added (`releaseAt()`, the newest release tag the tree builds on, so
  `7.1.6` reads "added after 7.1.6 shipped"; read only for a code the list
  does not yet hold) — and its status — `live`,
  `retired` (with
  the version that retired it) or `historical`, declared beside the code as
  a closed union. Historical codes carry legacy causes and are never mapped
  onto live ones.
- Codes are added and marked retired, never edited or reused. A behaviour
  change — the rule now picks different records — mints a new code; a fix
  that leaves the picked set unchanged keeps its code. CI diffs the
  generated list against its merge-base copy and fails if any code there is
  missing, renamed, or has a changed stage, effect, role, description or
  first version, or a status moving any way but live to retired. The copy is
  read by its own header (`parseListedCodes`), so a column the list gains is
  compared from the first copy that carries it.
- No placeholder codes. A stage gets its real codes before any change
  orphans a SID through it; an `*.unrecorded` code would be written into
  append-only `events.tsv` for good.
