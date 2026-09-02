// The classic-ID overlay's label merge: overlay ∪ spine per identifier, with
// the collision guard and the curated overrides. See README.md § The label
// merge and docs/catalog-driver.md § 4.
import { starDesignations } from '../../sid/sid-pure';
import { dataRows, nonEmpty, parseIntOrNull } from '../parse/corpus-tsv';
import type { SpineRow } from '../spine/inherited-spine-pure';
import {
  glieseNumber,
  OVERLAY_VALUE_SEPARATOR,
  type ClassicIdOverlay,
  type OverlayEntry,
} from './classic-id-overlay-pure';

export const LABEL_FIELDS = ['hip', 'hd', 'hr', 'gl', 'flam'] as const;
export type LabelField = (typeof LABEL_FIELDS)[number];

/** Repo-relative, so the emitter and every reader resolve one path. */
export const CLASSIC_ID_OVERRIDES_FILE = 'data/classic-ids/classic_id_overrides.tsv';
export const LABEL_FLIPS_FILE = 'data/classic-ids/label_flips.tsv';

/** Per-identifier count partition, one bucket per merged field. */
export type LabelPartition = Record<LabelField, number>;

export function emptyLabelPartition(): LabelPartition {
  return { hip: 0, hd: 0, hr: 0, gl: 0, flam: 0 };
}

/** The mutable identifier subset of a catalog record the merge writes. `Star`
 *  satisfies it structurally, so the merge stays free of the stars-parse
 *  import. `bayer` is deliberately absent: IV/27A spells Bayer letters "alf"
 *  where the spine spells them "Alp", and choosing between the two is the
 *  naming ladder's gate (docs/star-naming.md), not this join's. */
export interface LabelMergeRecord {
  gaiaSourceId: string | null;
  hip: number | null;
  hd: number | null;
  hr: number | null;
  gl: string | null;
  flam: number | null;
  /** Written by the merge, never read by it: the further values of an
   *  ambiguous designation the single-valued field above cannot hold. */
  hdAlt: number[];
  hrAlt: number[];
}

export type LabelDisposition =
  | 'added'
  | 'overlay-wins'
  | 'override-spine'
  | 'override-value'
  | 'suppressed-collision'
  | 'extra-alias'
  | 'extra-sibling-rendered'
  | 'extra-dropped';

/** One row of the committed review queue — every place the merge's output
 *  departs from the spine's labels, plus the values a single-valued field could
 *  not carry. The queue is therefore the COMPLETE delta, which is what lets
 *  `../spine/inherited-spine-parity.test.ts` keep asserting an exact
 *  designation multiset: spine ∘ queue = build. Sort by `disposition` to read
 *  it as a review list — `overlay-wins` and the two `override-*` rows are the
 *  adjudications, `added` rows are monotone coverage gains. */
export interface LabelFlip {
  sourceId: string;
  label: string;
  field: LabelField;
  spine: string;
  overlay: string;
  /** The value this row is ABOUT, which is what the record took only where the
   *  disposition writes: on an `extra-alias` / `extra-dropped` row it is the
   *  value the field did not take, and the record carries `spine`. */
  applied: string;
  disposition: LabelDisposition;
}

/** The label-parity measurement AND the merge's own routing, in one partition
 *  set: per identifier, `labelAgree + labelFlipped + labelSpineOnly` is every
 *  record the spine labels, and `labelAgree` is the subset the overlay
 *  reproduces — so coverage is a ratio of these counts rather than a second
 *  walk that could disagree with what the build actually wrote. */
export interface LabelMergeCounts {
  /** Records the overlay has no row for at all — the spine backstop's reach
   *  (`data/classic-ids/README.md` § Coverage). */
  labelNoOverlayEntry: number;
  /** Spine value confirmed by the overlay; the spine's own spelling is kept. */
  labelAgree: LabelPartition;
  /** Identifier the spine had no value for at all. */
  labelAdded: LabelPartition;
  /** Overlay value adopted over a disagreeing spine value (§ 4 precedence). */
  labelFlipped: LabelPartition;
  /** Spine value kept because the overlay asserts none for this identifier —
   *  including every record it has no row for. */
  labelSpineOnly: LabelPartition;
  /** Proposals withheld by the collision guard. */
  labelSuppressed: LabelPartition;
  /** Overlay values the field could not display but the record still answers
   *  to — a search key and a same-as designation. */
  labelExtraAlias: LabelPartition;
  /** Extras withheld because the pair's other component is a record of its
   *  own: the number names that record, not this one. */
  labelExtraSiblingRendered: LabelPartition;
  /** Overlay values a single-valued field cannot carry beside the one it took
   *  AND has no alias list to hold, so the record will not answer to them. */
  labelExtraDropped: LabelPartition;
  /** Cells a curated override decided. */
  labelOverridden: LabelPartition;
}

export function emptyLabelMergeCounts(): LabelMergeCounts {
  return {
    labelNoOverlayEntry: 0,
    labelAgree: emptyLabelPartition(),
    labelAdded: emptyLabelPartition(),
    labelFlipped: emptyLabelPartition(),
    labelSpineOnly: emptyLabelPartition(),
    labelSuppressed: emptyLabelPartition(),
    labelExtraAlias: emptyLabelPartition(),
    labelExtraSiblingRendered: emptyLabelPartition(),
    labelExtraDropped: emptyLabelPartition(),
    labelOverridden: emptyLabelPartition(),
  };
}

/** CNS5's `gj` cell as the record's display string. CNS5 *is* the GJ
 *  catalogue, so its numbers print with its own prefix; wherever the two agree
 *  the record keeps whatever the spine printed, and search dispatch accepts
 *  either spelling. */
export function formatGlieseDisplay(cell: string): string {
  return `GJ ${cell}`;
}

function flamsteedNumber(cell: string): number | null {
  const m = /^(\d+)/.exec(cell.trim());
  return m ? Number(m[1]) : null;
}

/** How one identifier is read off a record, proposed from the overlay, and
 *  compared across the two catalogues' conventions. One table drives every
 *  field so the merge rule is stated exactly once. */
interface FieldSpec {
  field: LabelField;
  read: (r: LabelMergeRecord) => string | null;
  write: (r: LabelMergeRecord, value: string) => void;
  /** Overlay candidates in the record's own representation, best first. */
  candidates: (e: OverlayEntry) => string[];
  /** Comparison key — the two conventions normalised onto one form. */
  same: (value: string) => string;
  /** Where the values the single-valued field cannot hold go, or null where
   *  the field has nowhere to put them. Null is what separates the two extra
   *  dispositions: a carried value stays searchable and keys the same-as
   *  class, a dropped one is a label the record will not answer to. */
  writeAlt: ((r: LabelMergeRecord, values: readonly string[]) => void) | null;
}

function numericSpec(
  field: 'hip' | 'hd' | 'hr',
  candidates: (e: OverlayEntry) => readonly number[],
  writeAlt: FieldSpec['writeAlt'] = null,
): FieldSpec {
  return {
    field,
    read: (r) => {
      const v = r[field];
      return v === null ? null : String(v);
    },
    write: (r, value) => {
      r[field] = Number(value);
    },
    candidates: (e) => [...candidates(e)].sort((a, b) => a - b).map(String),
    same: (value) => value,
    writeAlt,
  };
}

export const LABEL_FIELD_SPECS: readonly FieldSpec[] = [
  numericSpec('hip', (e) => e.hip),
  numericSpec('hd', (e) => e.hd, (r, values) => {
    r.hdAlt = values.map(Number);
  }),
  numericSpec('hr', (e) => e.hr, (r, values) => {
    r.hrAlt = values.map(Number);
  }),
  {
    field: 'gl',
    read: (r) => r.gl,
    write: (r, value) => {
      r.gl = value;
    },
    writeAlt: null,
    candidates: (e) => [...e.gj].sort().map(formatGlieseDisplay),
    same: (value) => glieseNumber(value) ?? value,
  },
  {
    field: 'flam',
    read: (r) => (r.flam === null ? null : String(r.flam)),
    write: (r, value) => {
      r.flam = Number(value);
    },
    writeAlt: null,
    candidates: (e) => {
      const nums = e.flamsteed
        .map(flamsteedNumber)
        .filter((n): n is number => n !== null);
      return [...new Set(nums)].sort((a, b) => a - b).map(String);
    },
    same: (value) => value,
  },
];

/** A curated decision for one record's one identifier: an explicit value, or
 *  an empty value meaning "keep the spine's". Same escape-hatch shape as
 *  `data/simbad/wds_xids_overrides.tsv` — a mechanical rule with a reviewed
 *  exception list beats a rule with the exceptions written into it. */
export type LabelOverrides = Map<string, string | null>;

export function overrideKey(sourceId: string, field: LabelField): string {
  return `${sourceId}\t${field}`;
}

const OVERRIDES_COLUMNS = ['gaia_source_id', 'field', 'value'] as const;

export function parseLabelOverridesTsv(text: string): LabelOverrides {
  const out: LabelOverrides = new Map();
  const known = new Set<string>(LABEL_FIELDS);
  for (const { cells, idx } of dataRows(
    text,
    OVERRIDES_COLUMNS,
    'classic_id_overrides.tsv',
    'Columns are gaia_source_id, field, value (empty value = keep the spine).',
  )) {
    const sourceId = nonEmpty(cells[idx.gaia_source_id]);
    const field = nonEmpty(cells[idx.field]);
    if (sourceId === null || sourceId.startsWith('#') || field === null) continue;
    if (!known.has(field)) {
      throw new Error(
        `classic_id_overrides.tsv: "${field}" is not a merged identifier ` +
          `(${LABEL_FIELDS.join(', ')})`,
      );
    }
    out.set(overrideKey(sourceId, field as LabelField), nonEmpty(cells[idx.value]));
  }
  return out;
}

/** A spine row as the merge's record + its review-queue label. The emitter
 *  merges over the spine because that is the membership term — the record build
 *  merges the same overlay over its own `Star` records, and the two count
 *  snapshots agreeing is what proves the committed queue describes the shipped
 *  labels. */
export function spineLabelMergeRecord(
  row: SpineRow,
): { record: LabelMergeRecord; label: string } {
  return {
    record: {
      gaiaSourceId: nonEmpty(row.gaia_source_id),
      hip: parseIntOrNull(row.hip),
      hd: parseIntOrNull(row.hd),
      hr: parseIntOrNull(row.hr),
      gl: nonEmpty(row.gl),
      flam: parseIntOrNull(row.flam),
      hdAlt: [],
      hrAlt: [],
    },
    label: labelForReview({
      proper: nonEmpty(row.proper),
      hip: parseIntOrNull(row.hip),
      hd: parseIntOrNull(row.hd),
      gaiaSourceId: nonEmpty(row.gaia_source_id),
    }),
  };
}

/** How a record names itself in the review queue. Shared by the emitter and
 *  the record build, and read off the PRE-merge identifiers in both, so the two
 *  runs produce a byte-identical queue — which is what the record build's
 *  equality check against the committed file is asserting. */
export function labelForReview(fields: {
  proper: string | null;
  hip: number | null;
  hd: number | null;
  gaiaSourceId: string | null;
}): string {
  const named = [
    fields.proper,
    fields.hip === null ? null : `HIP ${fields.hip}`,
    fields.hd === null ? null : `HD ${fields.hd}`,
  ].filter((p): p is string => p !== null);
  return named.length > 0 ? named.join(' / ') : `Gaia ${fields.gaiaSourceId}`;
}

const LABEL_FLIPS_COLUMNS = [
  'gaia_source_id', 'label', 'field', 'spine', 'overlay', 'applied', 'disposition',
] as const;

const LABEL_FLIPS_HEADER = LABEL_FLIPS_COLUMNS.join('\t');

/** The committed review queue. Sorted by field then source_id so a diff reads
 *  as "which rows changed disposition", not "which order the walk ran in". */
export function labelFlipsTsv(flips: readonly LabelFlip[]): string {
  const rank = (f: LabelField): number => LABEL_FIELDS.indexOf(f);
  const lines = [...flips]
    .sort((a, b) => rank(a.field) - rank(b.field)
      || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)
      || (a.disposition < b.disposition ? -1 : 1))
    .map((f) => [
      f.sourceId, f.label, f.field, f.spine, f.overlay, f.applied, f.disposition,
    ].join('\t'));
  return `${[LABEL_FLIPS_HEADER, ...lines].join('\n')}\n`;
}

/** Which SID designation namespace an identifier keys, per `docs/sid.md` § 3.
 *  A Flamsteed number keys none: it is a display designation the search index
 *  carries, never an identity key. */
function designationFor(field: LabelField, value: string): string | null {
  if (field === 'flam') return null;
  const empty = {
    isSol: false, hip: null, hd: null, hr: null, gl: null,
    gaiaSourceId: null, syntheticId: null,
  };
  const fields = field === 'gl'
    ? { ...empty, gl: value }
    : { ...empty, [field]: Number(value) };
  return starDesignations(fields)[0] ?? null;
}

/** What the disposition does to the record's designation set: whether it puts
 *  the queue's value on the record, and whether the spine's value leaves. The
 *  two part company on `extra-alias`, which adds a second designation without
 *  displacing the first. Total over the union, so a new disposition has to be
 *  classified here before anything reading the queue compiles. */
const DISPOSITION_EFFECT: Record<
  LabelDisposition,
  { adds: boolean; removesSpine: boolean }
> = {
  added: { adds: true, removesSpine: true },
  'overlay-wins': { adds: true, removesSpine: true },
  'override-value': { adds: true, removesSpine: true },
  'override-spine': { adds: false, removesSpine: false },
  'suppressed-collision': { adds: false, removesSpine: false },
  'extra-alias': { adds: true, removesSpine: false },
  'extra-sibling-rendered': { adds: false, removesSpine: false },
  'extra-dropped': { adds: false, removesSpine: false },
};

/** Net designation change the queue describes, as a multiset delta. Applying
 *  it to the spine's designation tally must reproduce the built catalogue's —
 *  the equality that keeps "every SID is preserved by construction" checkable
 *  once the labels stop being the spine's verbatim. */
export function labelFlipDesignationDelta(
  flips: readonly LabelFlip[],
): Map<string, number> {
  const delta = new Map<string, number>();
  const move = (designation: string | null, by: number): void => {
    if (designation === null) return;
    delta.set(designation, (delta.get(designation) ?? 0) + by);
  };
  for (const designation of spineDesignationsRemovedBy(flips)) move(designation, -1);
  for (const flip of flips) {
    if (!DISPOSITION_EFFECT[flip.disposition].adds) continue;
    move(designationFor(flip.field, flip.applied), +1);
  }
  return delta;
}

/** The spine designations the queue takes off their record, unnetted. The
 *  delta above cancels one against an addition that lands the same designation
 *  on another record, which is exactly what a same-as class cares about and
 *  exactly what a ledger canonical key does not — its row resolves through the
 *  record it was keyed on (`../spine/README.md` § The swap parity ledger). */
export function spineDesignationsRemovedBy(flips: readonly LabelFlip[]): string[] {
  const removed: string[] = [];
  for (const flip of flips) {
    if (!DISPOSITION_EFFECT[flip.disposition].removesSpine || flip.spine === '') continue;
    const designation = designationFor(flip.field, flip.spine);
    if (designation !== null) removed.push(designation);
  }
  return removed;
}

/** Read the committed queue back — the sibling of `labelFlipsTsv`, for the
 *  parity gate that replays it against the spine. */
export function parseLabelFlipsTsv(text: string): LabelFlip[] {
  const out: LabelFlip[] = [];
  for (const { cells, idx } of dataRows(
    text, LABEL_FLIPS_COLUMNS, 'label_flips.tsv',
    'Re-run `pnpm run build:classic-ids`.',
  )) {
    out.push({
      sourceId: cells[idx.gaia_source_id],
      label: cells[idx.label],
      field: cells[idx.field] as LabelField,
      spine: cells[idx.spine],
      overlay: cells[idx.overlay],
      applied: cells[idx.applied],
      disposition: cells[idx.disposition] as LabelDisposition,
    });
  }
  return out;
}

export interface LabelMergeInput<R extends LabelMergeRecord> {
  records: readonly R[];
  /** Review-queue label per record, same index space as `records`. */
  labels: readonly string[];
  overlay: ClassicIdOverlay;
  overrides: LabelOverrides;
  /** Source_ids whose `multiples.tsv` system names more than one component, so
   *  a second HD naming the pair's other component has a record of its own to
   *  belong to (§ An alias stops at the blend). Promotion only ever renders a
   *  secondary that exists as a member row, so this over-approximates the
   *  rendered set by design — withholding one alias too many is reviewable,
   *  leaving one on the wrong record is not. Both callers derive it from the
   *  committed table, which is what keeps the two review queues identical. */
  siblingRenderedSourceIds: ReadonlySet<string>;
}

export interface LabelMergeResult {
  counts: LabelMergeCounts;
  flips: LabelFlip[];
}

interface Proposal {
  recordIdx: number;
  spec: FieldSpec;
  spine: string | null;
  candidates: string[];
  /** The overlay value the merge intends to write; null where the spine's own
   *  value stands (it agreed, or the guard withheld the proposal). */
  value: string | null;
  override: string | null | undefined;
  suppressed: boolean;
  /** Set by `partitionExtras`: the candidates the field cannot display, split
   *  by what becomes of each. Disjoint, and together they are every extra. */
  aliasExtras: string[];
  siblingExtras: string[];
  droppedExtras: string[];
}

/** Merge the source_id-keyed classic-ID overlay onto each record's inherited
 *  labels, IN PLACE. Union semantics: the overlay adds identifiers the spine
 *  lacks and wins where the two disagree, but never removes one it has no
 *  opinion on — the overlay reaches 62–96% per identifier and has no row at all
 *  for 115 of the 178 records at V ≤ 3, so the spine is the backstop for a
 *  double-digit fraction of every label, not a rare fallback.
 *
 *  Two passes: the collision guard can only be scored against the post-merge
 *  assignment. */
export function mergeClassicIdLabels<R extends LabelMergeRecord>(
  input: LabelMergeInput<R>,
): LabelMergeResult {
  const { records, labels, overlay, overrides, siblingRenderedSourceIds } = input;
  const counts = emptyLabelMergeCounts();
  const flips: LabelFlip[] = [];
  const proposals: Proposal[] = [];

  records.forEach((r, recordIdx) => {
    const entry = r.gaiaSourceId === null ? undefined : overlay.get(r.gaiaSourceId);
    if (entry === undefined) counts.labelNoOverlayEntry++;
    for (const spec of LABEL_FIELD_SPECS) {
      const spine = spec.read(r);
      const candidates = entry === undefined ? [] : spec.candidates(entry);
      const override = r.gaiaSourceId === null
        ? undefined
        : overrides.get(overrideKey(r.gaiaSourceId, spec.field));
      if (override === undefined && candidates.length === 0) {
        if (spine !== null) counts.labelSpineOnly[spec.field]++;
        continue;
      }
      const agrees = spine !== null
        && candidates.some((c) => spec.same(c) === spec.same(spine));
      proposals.push({
        recordIdx,
        spec,
        spine,
        candidates,
        value: override !== undefined ? override : agrees ? null : candidates[0],
        override,
        suppressed: false,
        aliasExtras: [], siblingExtras: [], droppedExtras: [],
      });
    }
  });

  applyCollisionGuard(records, proposals);
  partitionExtras(records, proposals, siblingRenderedSourceIds);

  for (const p of proposals) {
    const { spec, spine, candidates } = p;
    const field = spec.field;
    const record = records[p.recordIdx];
    const sourceId = record.gaiaSourceId ?? '';
    const overlayCell = candidates.join(OVERLAY_VALUE_SEPARATOR);
    const pushFlip = (applied: string, disposition: LabelDisposition): void => {
      flips.push({
        sourceId,
        label: labels[p.recordIdx],
        field,
        spine: spine ?? '',
        overlay: overlayCell,
        applied,
        disposition,
      });
    };

    if (p.value !== null) spec.write(record, p.value);

    if (p.override !== undefined) {
      counts.labelOverridden[field]++;
      pushFlip(p.value ?? spine ?? '', p.value === null ? 'override-spine' : 'override-value');
    } else if (p.suppressed) {
      counts.labelSuppressed[field]++;
      pushFlip(spine ?? '', 'suppressed-collision');
    } else if (p.value === null) {
      counts.labelAgree[field]++;
    } else if (spine === null) {
      counts.labelAdded[field]++;
      pushFlip(p.value, 'added');
    } else {
      counts.labelFlipped[field]++;
      pushFlip(p.value, 'overlay-wins');
    }

    // A single-valued field carries one of an ambiguous designation's several
    // values; `partitionExtras` decided what becomes of the rest.
    if (spec.writeAlt !== null && p.aliasExtras.length > 0) {
      spec.writeAlt(record, p.aliasExtras);
    }
    for (const [extras, partition, disposition] of [
      [p.aliasExtras, counts.labelExtraAlias, 'extra-alias'],
      [p.siblingExtras, counts.labelExtraSiblingRendered, 'extra-sibling-rendered'],
      [p.droppedExtras, counts.labelExtraDropped, 'extra-dropped'],
    ] as const) {
      partition[field] += extras.length;
      for (const extra of extras) pushFlip(extra, disposition);
    }
  }

  return { counts, flips };
}

const cellKey = (spec: FieldSpec, value: string): string =>
  `${spec.field}:${spec.same(value)}`;

const tally = (values: Iterable<string>): Map<string, number> => {
  const out = new Map<string, number>();
  for (const v of values) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
};

/** Withhold any proposal that would turn an unambiguous spine designation into
 *  an ambiguous one.
 *
 *  A designation covering more than one record names a catalogue granularity,
 *  so `docs/sid.md` § 4.1 drops it from the same-as graph entirely — it keys no
 *  ledger row. Attaching an identifier a DIFFERENT record already holds off the
 *  spine therefore deletes a working SID key from both records and buys
 *  nothing: the star stays findable under that identifier through the record
 *  that holds it. p Eridani (HIP 7751) and Gl 277A (HIP 36626) are today's two
 *  cases, and the second would go fully keyless and hard-fail allocation.
 *
 *  Withholding moves the assignment back toward the spine's, which is
 *  collision-free by construction, so the fixpoint converges — but one
 *  withheld proposal can re-expose a value its partner had proposed to vacate
 *  (the four HD mutual swaps), which is why this iterates instead of scoring
 *  once. */
function applyCollisionGuard<R extends LabelMergeRecord>(
  records: readonly R[],
  proposals: readonly Proposal[],
): void {
  const spineCells: string[] = [];
  for (const r of records) {
    for (const spec of LABEL_FIELD_SPECS) {
      const v = spec.read(r);
      if (v !== null) spineCells.push(cellKey(spec, v));
    }
  }
  const spineOwners = tally(spineCells);

  // Assignment as the proposals stand: every record's cells with each pending
  // proposal applied. Rebuilt each pass, since withholding one changes it.
  const movers = proposals.filter((p) => p.value !== null && p.override === undefined);
  const proposalByCell = new Map<string, Proposal>();
  for (const p of proposals) proposalByCell.set(`${p.recordIdx}\t${p.spec.field}`, p);

  for (let pass = 0; ; pass++) {
    const assigned: string[] = [];
    records.forEach((r, i) => {
      for (const spec of LABEL_FIELD_SPECS) {
        const p = proposalByCell.get(`${i}\t${spec.field}`);
        const value = p?.value ?? spec.read(r);
        if (value !== null) assigned.push(cellKey(spec, value));
      }
    });
    const owners = tally(assigned);
    let changed = false;
    for (const p of movers) {
      if (p.value === null) continue;
      const target = cellKey(p.spec, p.value);
      if ((owners.get(target) ?? 0) <= 1) continue;
      // Already ambiguous in the spine: attaching it costs nothing that was
      // not already lost, and the ambiguity policy owns the outcome.
      if ((spineOwners.get(target) ?? 0) > 1) continue;
      p.value = null;
      p.suppressed = true;
      changed = true;
    }
    if (!changed) return;
    if (pass >= LABEL_FIELDS.length) {
      throw new Error(
        'classic-ID label merge: the collision guard did not converge — a ' +
          'withheld proposal keeps re-exposing another record\'s value',
      );
    }
  }
}

/** Decide what becomes of each value a single-valued field could not display.
 *
 *  Three outcomes, and the field's `writeAlt` is only the first of the gates:
 *
 *  - **`extra-dropped`** — the field has no alias list, so there is nowhere to
 *    put the value and the record will not answer to it.
 *  - **`extra-sibling-rendered`** — the pair's other component is a record of
 *    its own, so the number names THAT record. HD numbered two spectra of a
 *    pair Tycho-2 sees as one entry, and the overlay hangs both numbers on the
 *    one source_id without saying which component is which; where the pair is
 *    resolved, letting the primary answer to both would point a number at a
 *    star we draw separately.
 *  - **`extra-alias`** — the pair is unresolved, so the single record carries
 *    both components' light and answers to both numbers. That is the
 *    granularity the catalogue has, not a misattribution: 93 of these have no
 *    `multiples.tsv` row at all, so no separation, position angle or component
 *    magnitude exists to split them with.
 *
 *  An alias also has to clear the collision guard's own rule, which
 *  `applyCollisionGuard` cannot apply for it: aliases are not display cells, so
 *  the guard's tally never sees them, and an alias equal to a value another
 *  record DISPLAYS would go ambiguous under `docs/sid.md` § 4.1 and cost both
 *  records the key. Such a value is withheld to `extra-dropped` — the record
 *  keeps its own display value and the queue carries the withheld label. */
function partitionExtras<R extends LabelMergeRecord>(
  records: readonly R[],
  proposals: readonly Proposal[],
  siblingRenderedSourceIds: ReadonlySet<string>,
): void {
  /** Candidates the field will not display, deduplicated on the comparison key
   *  so one overlay cell repeating a value cannot propose it twice. */
  const extrasOf = (p: Proposal): string[] => {
    const applied = p.value ?? p.spine;
    const appliedKey = applied === null ? null : p.spec.same(applied);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const candidate of p.candidates) {
      const key = p.spec.same(candidate);
      if (key === appliedKey || seen.has(key)) continue;
      seen.add(key);
      out.push(candidate);
    }
    return out;
  };

  const active = proposals.filter((p) => !p.suppressed && p.override === undefined);
  const byCell = new Map<string, Proposal>();
  for (const p of proposals) byCell.set(`${p.recordIdx}\t${p.spec.field}`, p);
  const spineOwners = tally(cellsOf(records, (r, spec) => spec.read(r)));
  const displayOwners = tally(cellsOf(
    records,
    (r, spec, i) => byCell.get(`${i}\t${spec.field}`)?.value ?? spec.read(r),
  ));
  const aliasProposed = tally(
    active.flatMap((p) => (p.spec.writeAlt === null ? [] : extrasOf(p).map((e) => cellKey(p.spec, e)))),
  );

  for (const p of active) {
    const extras = extrasOf(p);
    if (p.spec.writeAlt === null) {
      p.droppedExtras = extras;
      continue;
    }
    const sourceId = records[p.recordIdx].gaiaSourceId;
    for (const extra of extras) {
      const key = cellKey(p.spec, extra);
      const claims = (displayOwners.get(key) ?? 0) + (aliasProposed.get(key) ?? 0);
      if (sourceId !== null && siblingRenderedSourceIds.has(sourceId)) {
        p.siblingExtras.push(extra);
      } else if (claims > 1 && (spineOwners.get(key) ?? 0) <= 1) {
        p.droppedExtras.push(extra);
      } else {
        p.aliasExtras.push(extra);
      }
    }
  }
}

/** Every record's cell per field, as comparison keys, skipping the fields a
 *  record has no value for. */
function cellsOf<R extends LabelMergeRecord>(
  records: readonly R[],
  value: (r: R, spec: FieldSpec, i: number) => string | null,
): string[] {
  const out: string[] = [];
  records.forEach((r, i) => {
    for (const spec of LABEL_FIELD_SPECS) {
      const v = value(r, spec, i);
      if (v !== null) out.push(cellKey(spec, v));
    }
  });
  return out;
}
