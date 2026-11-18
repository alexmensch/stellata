// Each pair of records drawn inside one another, as the `overlap` lineage stage, and its invariant. See README.md#overlap-lineage.

import { namedRow, namedRowsInvariant, type LineageInvariant } from '../lineage/lineage-invariant-pure';
import { compareUtf8, stageLineageLine, stageRow, type LineageLine } from '../lineage/lineage-row-pure';
import { outcomeCode, stageCodes, type StageCounts } from '../lineage/reason-codes/reason-codes-pure';
import { OVERLAP_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';
import type { Sorted } from '../record/record-phase';

export const OVERLAP_LINEAGE_BUDGET = { gzipBytes: 2_000, writeMs: 1_000 };

export const OVERLAP_CODES = stageCodes(OVERLAP_LINEAGE.stage, {
  inside: outcomeCode('A record drawn inside another at the positions the catalogue ships, no orbit chain holding them apart; params name the other record.'),
});

export type OverlapCounts = StageCounts<typeof OVERLAP_CODES>;

const KNOWN_OVERLAPS = new Map([
  [namedRow('multiples:00315-6257-FH/H', { other: 'multiples:00315-6257-FI/I' }), 'WDS 00315-6257: H and I, siblings of F'],
  [namedRow('multiples:00315-6257-FH/H', { other: 'multiples:00315-6257-Fa,Fb/Fb' }), 'WDS 00315-6257: H of FH and Fb of Fa,Fb, companions of F at two levels'],
  [namedRow('multiples:00315-6257-FI/I', { other: 'multiples:00315-6257-Fa,Fb/Fb' }), 'WDS 00315-6257: I of FI and Fb of Fa,Fb, companions of F at two levels'],
  [namedRow('multiples:00335+4006-AB/B', { other: 'multiples:00335+4006-Aa,Ab/Ab' }), 'WDS 00335+4006: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:00335+4006-AB/B', { other: 'multiples:00335+4006-Aa1,Aa2/Aa2' }), 'WDS 00335+4006: B of AB and Aa2 of Aa1,Aa2, companions of A at two levels'],
  [namedRow('multiples:00335+4006-Aa,Ab/Ab', { other: 'multiples:00335+4006-Aa1,Aa2/Aa2' }), 'WDS 00335+4006: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:00533+0405-Aa,Ab/Ab', { other: 'multiples:00533+0405-Ba,Bb/Bb' }), 'WDS 00533+0405: Ab of Aa,Ab and Bb of Ba,Bb'],
  [namedRow('multiples:01051+1457-Aa,Ab/Ab', { other: 'multiples:01051+1457-Aa1,Aa2/Aa2' }), 'WDS 01051+1457: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:01096-4616-AB/B', { other: 'multiples:01096-4616-Aa,Ab/Ab' }), 'WDS 01096-4616: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:03271+1845-AB/B', { other: 'multiples:03271+1845-Aa,Ab/Ab' }), 'WDS 03271+1845: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:03272+0944-Aa,Ab/Ab', { other: 'multiples:03272+0944-Aa1,2/2' }), 'WDS 03272+0944: Ab of Aa,Ab and 2 of Aa1,2, companions of Aa at two levels'],
  [namedRow('multiples:03579+4001-Aa,Ab/Ab', { other: 'multiples:03579+4001-Aa1,Aa2/Aa2' }), 'WDS 03579+4001: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:04142+2813-Aa,Ab/Ab', { other: 'multiples:04142+2813-Aa1,2/2' }), 'WDS 04142+2813: Ab of Aa,Ab and 2 of Aa1,2, companions of Aa at two levels'],
  [namedRow('multiples:04226+2538-Ba,Bb/Bb', { other: 'multiples:04226+2538-Ba1,Ba2/Ba2' }), 'WDS 04226+2538: Bb of Ba,Bb and Ba2 of Ba1,Ba2, companions of Ba at two levels'],
  [namedRow('multiples:04247+0442-AB/B', { other: 'multiples:04247+0442-Aa,Ab/Ab' }), 'WDS 04247+0442: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:04331+2410-Aa,b1/b1', { other: 'multiples:04331+2410-Aa,b2/b2' }), 'WDS 04331+2410: b1 and b2, siblings of Aa'],
  [namedRow('multiples:05353-0523-Ca,Cb/Cb', { other: 'multiples:05353-0523-Ca1,Ca2/Ca2' }), 'WDS 05353-0523: Cb of Ca,Cb and Ca2 of Ca1,Ca2, companions of Ca at two levels'],
  [namedRow('multiples:05355-0516-Aa,Ab/Ab', { other: 'multiples:05355-0516-Aa1,Aa2/Aa2' }), 'WDS 05355-0516: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:06035+1941-AB/B', { other: 'multiples:06035+1941-Aa,Ab/Ab' }), 'WDS 06035+1941: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:06290+2013-Aa,Ab/Ab', { other: 'multiples:06290+2013-Aa1,2/2' }), 'WDS 06290+2013: Ab of Aa,Ab and 2 of Aa1,2, companions of Aa at two levels'],
  [namedRow('multiples:08480+0308-AB/B', { other: 'multiples:08480+0308-AC/C' }), 'WDS 08480+0308: B and C, siblings of A, listed by WDS at one position'],
  [namedRow('multiples:09124-0707-AB/B', { other: 'multiples:09124-0707-Aa,Ab/Ab' }), 'WDS 09124-0707: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:09276-3500-AB/B', { other: 'multiples:09276-3500-Aa,Ab/Ab' }), 'WDS 09276-3500: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:10067+1754-Aa,Ab/Ab', { other: 'multiples:10067+1754-Aa,Ac/Ac' }), 'WDS 10067+1754: Ab and Ac, siblings of Aa'],
  [namedRow('multiples:10333+0622-AB/B', { other: 'multiples:10333+0622-AC/C' }), 'WDS 10333+0622: B and C, siblings of A'],
  [namedRow('multiples:10444-6000-Aa,Ac/Ac', { other: 'multiples:10444-6000-Aa1,Aa2/Aa2' }), 'WDS 10444-6000: Ac of Aa,Ac and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:10465-6416-AB/B', { other: 'multiples:10465-6416-Aa,Ab/Ab' }), 'WDS 10465-6416: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:11221-2447-Aa,Ab/Ab', { other: 'multiples:11221-2447-Ba,Bb/Bb' }), 'WDS 11221-2447: Ab of Aa,Ab and Bb of Ba,Bb'],
  [namedRow('multiples:11342+1101-Aa,Ab/Ab', { other: 'multiples:11342+1101-Aa1,Aa2/Aa2' }), 'WDS 11342+1101: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:12071+6905-Aa,Ab/Ab', { other: 'multiples:12071+6905-Aa1,Aa2/Aa2' }), 'WDS 12071+6905: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:12114-1647-Aa,Ab/Ab', { other: 'multiples:12114-1647-Aa1,Aa2/Aa2' }), 'WDS 12114-1647: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:12115+5325-AC/C', { other: 'multiples:12115+5325-Aa,Ab/Ab' }), 'WDS 12115+5325: C of AC and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:13073+0035-AC/C', { other: 'multiples:13073+0035-Aa,Ab/Ab' }), 'WDS 13073+0035: C of AC and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:13443-5101-A,Ba/Ba', { other: 'multiples:13443-5101-A,Bb/Bb' }), 'WDS 13443-5101: Ba and Bb, siblings of A'],
  [namedRow('multiples:13527-1843-AB/B', { other: 'multiples:13527-1843-Aa,Ab/Ab' }), 'WDS 13527-1843: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:13562+3627-AC/C', { other: 'multiples:13562+3627-Aa,Ab/Ab' }), 'WDS 13562+3627: C of AC and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:14089-4328-AD/D', { other: 'multiples:14089-4328-AE/E' }), 'WDS 14089-4328: D and E, siblings of A'],
  [namedRow('multiples:14191-1322-AB/B', { other: 'multiples:14191-1322-Aa,Ab/Ab' }), 'WDS 14191-1322: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:14404+2159-Aa,Ab/Ab', { other: 'multiples:14404+2159-Aa1,Aa2/Aa2' }), 'WDS 14404+2159: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:15169-6057-Aa,Ab/Ab', { other: 'multiples:15169-6057-Aa1,Aa2/Aa2' }), 'WDS 15169-6057: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:15536-3921-AB/B', { other: 'multiples:15536-3921-Aa,Ab/Ab' }), 'WDS 15536-3921: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:16315-3901-Aa,Ab/Ab', { other: 'multiples:16315-3901-Aa1,Aa2/Aa2' }), 'WDS 16315-3901: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:16329+0315-Aa,Ab/Ab', { other: 'multiples:16329+0315-Aa1,Aa2/Aa2' }), 'WDS 16329+0315: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:16413-4846-Aa,Ab/Ab', { other: 'multiples:16413-4846-Aa1,Aa2/Aa2' }), 'WDS 16413-4846: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:16416+3053-AB/B', { other: 'multiples:16416+3053-Aa,Ab/Ab' }), 'WDS 16416+3053: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:17038-3809-AB/B', { other: 'multiples:17038-3809-Aa,Ab/Ab' }), 'WDS 17038-3809: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:17336-3706-Aa,Ab/Ab', { other: 'multiples:17336-3706-Aa1,Aa2/Aa2' }), 'WDS 17336-3706: Ab of Aa,Ab and Aa2 of Aa1,Aa2, companions of Aa at two levels'],
  [namedRow('multiples:18024+2050-AB/B', { other: 'multiples:18024+2050-Aa,Ab/Ab' }), 'WDS 18024+2050: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:18171-5601-AB/B', { other: 'multiples:18171-5601-Aa,Ab/Ab' }), 'WDS 18171-5601: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:18439-0649-AB/B', { other: 'multiples:18439-0649-Aa,Ab/Ab' }), 'WDS 18439-0649: B of AB and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:19294-0703-Aa,Ab/Ab', { other: 'multiples:19294-0703-Aa1,2/2' }), 'WDS 19294-0703: Ab of Aa,Ab and 2 of Aa1,2, companions of Aa at two levels'],
  [namedRow('multiples:19407-0037-Aa,Ab/Ab', { other: 'multiples:19407-0037-Aa1,2/2' }), 'WDS 19407-0037: Ab of Aa,Ab and 2 of Aa1,2, companions of Aa at two levels'],
  [namedRow('multiples:19448+2916-Aa,Ab/Ab', { other: 'multiples:19448+2916-Aa1,2/2' }), 'WDS 19448+2916: Ab of Aa,Ab and 2 of Aa1,2, companions of Aa at two levels'],
  [namedRow('multiples:19512-7248-AD/D', { other: 'multiples:19512-7248-Aa,Ab/Ab' }), 'WDS 19512-7248: D of AD and Ab of Aa,Ab, companions of A at two levels'],
  [namedRow('multiples:19572+4022-Ba,Bb/Bb', { other: 'multiples:19572+4022-Ba1,Ba2/Ba2' }), 'WDS 19572+4022: Bb of Ba,Bb and Ba2 of Ba1,Ba2, companions of Ba at two levels'],
  [namedRow('multiples:23026+2948-AC/C', { other: 'multiples:23026+2948-Aa,Ab/Ab' }), 'WDS 23026+2948: C of AC and Ab of Aa,Ab, companions of A at two levels'],
]);

export const OVERLAP_INVARIANTS: readonly LineageInvariant[] = [
  namedRowsInvariant(
    OVERLAP_CODES, 'inside',
    'no record is drawn inside another outside an orbit chain but the pairs named (README.md#overlap-gate)',
    KNOWN_OVERLAPS,
  ),
];

/** One row per pair, keyed on the origin key first in byte order, so a pair keeps its row however the records sort. */
export function overlapLineageLines(
  pairs: readonly (readonly [number, number])[], records: Sorted<{ readonly originKey: string }>,
): LineageLine[] {
  return pairs.map(([a, b]) => {
    const [key, other] = [records[a].originKey, records[b].originKey].sort(compareUtf8);
    return stageLineageLine(OVERLAP_CODES, stageRow(OVERLAP_CODES, key, 'inside', { other }, []));
  });
}
