// Display naming as a lineage stage: its reason codes and the one serialiser over each record's naming outcome. See README.md#naming-lineage.

import { paramsOf, stageLineageLine, type LineageLine, type LineageParams, type LineageRow, stageRow } from '../lineage/lineage-row-pure';
import {
  outcomeCode, refusalCode, retired, stageCodes, type CodeDeclaration, type LIVE,
} from '../lineage/reason-codes/reason-codes-pure';
import { lineageInvariant, NO_EXCEPTIONS, type LineageInvariant } from '../lineage/lineage-invariant-pure';
import type { NamedRecord, NamingDerivedCounts } from './display-names';
import type { StarNamingCounts } from './apply-star-names';
import {
  designationAtTier,
  BORROWABLE_TIERS,
  NAME_TIERS,
  type BorrowReason,
  type DesignationSet,
  type NameTier,
} from '../../../src/catalog-format/naming/star-naming-pure';
import { NAMING_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const NAMING_LINEAGE_BUDGET = { gzipBytes: 10_600_000, writeMs: 28_000 };

const RETIRED_7_1_17 = retired('7.1.17');

const TIER_CODES = {
  override: 'override', iau: 'iau', eponym: 'eponym', bayer: 'bayer', flamsteed: 'flamsteed',
  bayer_latin: 'bayer-latin', gould: 'gould', gcvs: 'gcvs', catalogue: 'catalogue',
} as const satisfies Record<NameTier, string>;
type TierCode = (typeof TIER_CODES)[NameTier];

const TIER_DESIGNATIONS: Record<NameTier, string> = {
  override: 'curated override name',
  iau: 'IAU WGSN approved name',
  eponym: 'string designation',
  bayer: 'Greek-letter Bayer designation',
  flamsteed: 'Flamsteed number',
  bayer_latin: 'Latin-letter Bayer designation',
  gould: 'Gould number',
  gcvs: 'GCVS variable designation',
  catalogue: 'catalogue number',
};

const OWN = 'The record displays the highest tier of the naming ladder it carries in its own right';
const BORROWED: Record<BorrowReason, string> = {
  'no-own-designation': 'The record is a WDS component with no designation of its own, so it displays its system anchor\'s base with its component letter',
  'system-designation': 'The record\'s own designation is one its system anchor also carries, so it displays the anchor\'s base with its component letter',
  'outranked-identifier': 'The record\'s own designation is a GCVS serial or catalogue number ranked below its system anchor\'s tier, so it displays the anchor\'s base with its component letter',
};
const BORROW_REASONS = Object.keys(BORROWED) as BorrowReason[];

/** One live code per tier under `prefix`, the label's tier named in each description. */
function perTier<P extends string>(
  prefix: P, description: string, whose: string, tiers: readonly NameTier[] = NAME_TIERS,
): Record<`${P}.${TierCode}`, CodeDeclaration<typeof LIVE>> {
  return Object.fromEntries(tiers.map((tier) => [
    `${prefix}.${TIER_CODES[tier]}`, outcomeCode(`${description}: ${whose} ${TIER_DESIGNATIONS[tier]}.`),
  ])) as Record<`${P}.${TierCode}`, CodeDeclaration<typeof LIVE>>;
}

export const NAMING_CODES = stageCodes(NAMING_LINEAGE.stage, {
  'name.own': outcomeCode(`${OWN}.`, 'none', RETIRED_7_1_17),
  ...perTier('name.own', OWN, 'its'),
  'name.borrowed.no-own-designation': outcomeCode(`${BORROWED['no-own-designation']}.`, 'none', RETIRED_7_1_17),
  ...perTier('name.borrowed.no-own-designation', BORROWED['no-own-designation'], 'the anchor\'s', BORROWABLE_TIERS['no-own-designation']),
  'name.borrowed.system-designation': outcomeCode(`${BORROWED['system-designation']}.`, 'none', RETIRED_7_1_17),
  ...perTier('name.borrowed.system-designation', BORROWED['system-designation'], 'the anchor\'s', BORROWABLE_TIERS['system-designation']),
  'name.borrowed.outranked-identifier': outcomeCode(`${BORROWED['outranked-identifier']}.`, 'none', RETIRED_7_1_17),
  ...perTier('name.borrowed.outranked-identifier', BORROWED['outranked-identifier'], 'the anchor\'s', BORROWABLE_TIERS['outranked-identifier']),
  'name.unlabelled': outcomeCode('The record carries nothing the ladder renders and has no anchor to borrow from, so the runtime displays its Gaia DR3 or SID fallback.'),
  'name.lower-tier': refusalCode('A designation the record carries, refused because a higher tier of the ladder supplied its label.'),
  'name.borrowed-over': refusalCode('A designation the record carries, refused because it displays its system anchor\'s base instead.'),
  'letter.stated': outcomeCode('The label carries the component letter the naming authority attributes the record\'s designation to.'),
  'letter.sibling-owns': outcomeCode('The label carries the record\'s WDS component letter because another record owns the same designation.'),
  'letter.borrowed': outcomeCode('The label carries the record\'s WDS component letter after its system anchor\'s borrowed base.'),
  'dc.wgsn-bayer': outcomeCode('The record\'s designations render against the constellation the IAU WGSN Bayer designation is named for.'),
  'dc.wgsn-gould': outcomeCode('The record\'s designations render against the constellation the IAU WGSN Gould designation is named for.'),
  'dc.iv27a': outcomeCode('The record\'s designations render against the constellation IV/27A gives its HD or HIP number.'),
  'dc.gcvs': outcomeCode('The record\'s designations render against the constellation its GCVS designation names.'),
  'dc.anchor': outcomeCode('The record\'s designations render against the designation constellation of its system anchor.'),
  'dc.positional': outcomeCode('No tier states a designation constellation, so the record\'s designations render against the constellation its position lies in.'),
  'dc.none': outcomeCode('No tier states a designation constellation and the record has no positional one, so its Bayer, Flamsteed and Gould designations cannot render.'),
  'dc.displaced': refusalCode('The IV/27A constellation, refused because the IAU WGSN designation names a different one.'),
});

type Branch = Parameters<typeof NAMING_CODES.code>[0];

export const NAMING_INVARIANTS: readonly LineageInvariant[] = [
  lineageInvariant(
    NAMING_CODES, 'dc.none',
    'every record carrying a Bayer, Flamsteed or Gould designation has a constellation to render it against',
    NO_EXCEPTIONS,
  ),
];

/** Structural subset of `Star` the serialiser reads. */
export interface NamingLineageRecord {
  originKey: string;
}

type TierParams = { tier: NameTier; label: string };

type ParamsOf<B extends Branch> =
  B extends 'name.lower-tier' | 'name.borrowed-over' ? TierParams
  : B extends `name.own.${string}` ? { label: string }
  : B extends `name.borrowed.${string}` ? { label: string; anchor: string; comp: string }
  : B extends `letter.${string}` ? { comp: string }
  : B extends 'dc.none' | 'name.unlabelled' ? Record<string, never>
  : { con: string };

/** The ladder's tiers the set carries, in rank order, from `after` on. */
function carriedTiers(set: DesignationSet, after: NameTier | null): TierParams[] {
  const from = after === null ? 0 : NAME_TIERS.indexOf(after) + 1;
  return NAME_TIERS.slice(from).flatMap((tier) => {
    const label = designationAtTier(set, tier);
    return label === null ? [] : [{ tier, label }];
  });
}

const hasSkyDesignation = (set: DesignationSet): boolean =>
  set.bayer !== undefined || set.flamsteed !== undefined || set.gould !== undefined;

export function* namingLineageRows(
  records: readonly NamedRecord[],
  stars: readonly NamingLineageRecord[],
  constellations: readonly { code: string }[],
): Generator<LineageRow> {
  for (let i = 0; i < records.length; i++) {
    const key = stars[i].originKey;
    const row = <B extends Branch>(branch: B, params: ParamsOf<B>): LineageRow => (
      stageRow(NAMING_CODES, key, branch, params as LineageParams, [])
    );
    const { name, set, dc } = records[i];
    switch (name.kind) {
      case 'unlabelled':
        yield row('name.unlabelled', {});
        break;
      case 'own':
        yield row(`name.own.${TIER_CODES[name.tier]}`, { label: name.label });
        for (const t of carriedTiers(set, name.tier)) yield row('name.lower-tier', t);
        if (name.letter !== null) {
          yield row(name.letter.source === 'stated' ? 'letter.stated' : 'letter.sibling-owns', { comp: name.letter.comp });
        }
        break;
      case 'borrowed':
        yield row(`name.borrowed.${name.reason}.${TIER_CODES[name.tier]}`, {
          label: name.label, anchor: stars[name.anchorKey].originKey, comp: name.comp,
        });
        for (const t of carriedTiers(set, null)) yield row('name.borrowed-over', t);
        yield row('letter.borrowed', { comp: name.comp });
        break;
      default: {
        const unmapped: never = name;
        throw new Error(`naming outcome with no row mapping: ${JSON.stringify(unmapped)}`);
      }
    }
    if (!hasSkyDesignation(set)) continue;
    if (dc.from === 'none') {
      yield row('dc.none', {});
      continue;
    }
    if (dc.from === 'positional') {
      yield row('dc.positional', { con: constellations[dc.index].code });
      continue;
    }
    const source = dc.con;
    const con = constellations[source.index].code;
    switch (source.via) {
      case 'iv27a': case 'gcvs': case 'anchor':
        yield row(`dc.${source.via}`, { con });
        break;
      case 'wgsn-bayer': case 'wgsn-gould':
        yield row(`dc.${source.via}`, { con });
        if (source.displaced !== null) {
          yield row('dc.displaced', { con: constellations[source.displaced].code });
        }
        break;
      default: {
        const unmapped: never = source;
        throw new Error(`designation constellation source with no row mapping: ${JSON.stringify(unmapped)}`);
      }
    }
  }
}

type LiveCode = (typeof NAMING_CODES.live)[number];

/** Naming's lines folded per live code. */
export type NamingCodeCounts = Readonly<Record<LiveCode, number>>;

/** Naming's count block: its code counts and the authority pass's tally, which has no codes. */
export type NamingCounts = NamingCodeCounts & StarNamingCounts;

const nameCode = (branch: `name.own.${TierCode}` | `name.borrowed.${BorrowReason}.${TierCode}`): LiveCode =>
  NAMING_CODES.code(branch) as LiveCode;
const OWN_CODES: readonly LiveCode[] = NAME_TIERS.map((tier) => nameCode(`name.own.${TIER_CODES[tier]}`));
const BORROWED_CODES: readonly LiveCode[] = BORROW_REASONS.flatMap((reason) => (
  BORROWABLE_TIERS[reason].map((tier) => nameCode(`name.borrowed.${reason}.${TIER_CODES[tier]}`))
));
const LABELLED_CODES: ReadonlySet<string> = new Set([...OWN_CODES, ...BORROWED_CODES]);
const UNLABELLED_CODE = NAMING_CODES.code('name.unlabelled');

export function namingSummary(counts: NamingCodeCounts, derived: NamingDerivedCounts): string {
  const sum = (codes: readonly LiveCode[]): number => codes.reduce((n, code) => n + counts[code], 0);
  const lettered = counts['naming.letter.stated'] + counts['naming.letter.sibling-owns'];
  const lines = [
    `Display names: ${sum([...OWN_CODES, ...BORROWED_CODES])} composed `
      + `(${derived.nameTableEntries} names in catalog.bin, ${sum(BORROWED_CODES)} borrowed from a system anchor, `
      + `${lettered} lettered, ${counts['naming.name.unlabelled']} unlabelled)`,
  ];
  if (derived.namingDuplicateLabels > 0) {
    lines.push(
      `  ${derived.namingDuplicateLabels} duplicate label(s) across ${derived.namingDuplicateRecords} records — `
        + 'see naming/naming-parity.test.ts',
    );
  }
  return lines.join('\n');
}

/** By origin key; `null` for an unlabelled record. */
export function namingLabels(rows: Iterable<LineageRow>): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const r of rows) {
    const labelled = LABELLED_CODES.has(r.code);
    if (r.role !== 'outcome' || (!labelled && r.code !== UNLABELLED_CODE)) continue;
    if (out.has(r.key)) throw new Error(`naming lineage: two name rows for ${r.key}`);
    if (!labelled) {
      out.set(r.key, null);
      continue;
    }
    const { label } = paramsOf(r);
    if (label === undefined) throw new Error(`naming lineage: ${r.code} row for ${r.key} carries no label`);
    out.set(r.key, label);
  }
  return out;
}

/** Lines, never rows: the stage covers every record, so its rows are not held as objects. */
export function namingLineageLines(
  records: readonly NamedRecord[],
  stars: readonly NamingLineageRecord[],
  constellations: readonly { code: string }[],
): LineageLine[] {
  const lines: LineageLine[] = [];
  for (const row of namingLineageRows(records, stars, constellations)) lines.push(stageLineageLine(NAMING_CODES, row));
  return lines;
}
