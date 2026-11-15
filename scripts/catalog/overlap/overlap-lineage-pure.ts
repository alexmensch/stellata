// Each pair of records drawn inside one another, as the `overlap` lineage stage, and its invariant. See README.md#overlap-lineage.

import { namedExceptionsInvariant, namedRow, type LineageInvariant } from '../lineage/lineage-invariant-pure';
import { compareUtf8, stageLineageLine, stageRow, type LineageLine } from '../lineage/lineage-row-pure';
import { outcomeCode, stageCodes, type StageCounts } from '../lineage/reason-codes/reason-codes-pure';
import { OVERLAP_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const OVERLAP_LINEAGE_BUDGET = { gzipBytes: 2_000, writeMs: 1_000 };

export const OVERLAP_CODES = stageCodes(OVERLAP_LINEAGE.stage, {
  inside: outcomeCode('A record drawn inside another at the positions the catalogue ships, no orbit chain holding them apart; params name the other record.'),
});

export type OverlapCounts = StageCounts<typeof OVERLAP_CODES>;

const KNOWN_OVERLAPS = new Map([
  [namedRow('multiples:00315-6257-FH/H', { other: 'multiples:00315-6257-FI/I' }), 'synth-00315-6257-I | synth-00315-6257-H'],
  [namedRow('multiples:00315-6257-FH/H', { other: 'multiples:00315-6257-Fa,Fb/Fb' }), 'synth-00315-6257-Fb | synth-00315-6257-H'],
  [namedRow('multiples:00315-6257-FI/I', { other: 'multiples:00315-6257-Fa,Fb/Fb' }), 'synth-00315-6257-Fb | synth-00315-6257-I'],
  [namedRow('multiples:00335+4006-AB/B', { other: 'multiples:00335+4006-Aa,Ab/Ab' }), 'synth-00335+4006-Ab | synth-00335+4006-B'],
  [namedRow('multiples:00335+4006-AB/B', { other: 'multiples:00335+4006-Aa1,Aa2/Aa2' }), 'synth-00335+4006-B | synth-00335+4006-Aa2'],
  [namedRow('multiples:00335+4006-Aa,Ab/Ab', { other: 'multiples:00335+4006-Aa1,Aa2/Aa2' }), 'synth-00335+4006-Ab | synth-00335+4006-Aa2'],
  [namedRow('multiples:00533+0405-Aa,Ab/Ab', { other: 'multiples:00533+0405-Ba,Bb/Bb' }), 'synth-00533+0405-Bb | synth-00533+0405-Ab'],
  [namedRow('multiples:01051+1457-Aa,Ab/Ab', { other: 'multiples:01051+1457-Aa1,Aa2/Aa2' }), 'synth-01051+1457-Aa2 | synth-01051+1457-Ab'],
  [namedRow('multiples:01096-4616-AB/B', { other: 'multiples:01096-4616-Aa,Ab/Ab' }), 'synth-01096-4616-Ab | synth-01096-4616-B'],
  [namedRow('multiples:03271+1845-AB/B', { other: 'multiples:03271+1845-Aa,Ab/Ab' }), 'synth-03271+1845-B | synth-03271+1845-Ab'],
  [namedRow('multiples:03272+0944-Aa,Ab/Ab', { other: 'multiples:03272+0944-Aa1,2/2' }), 'synth-03272+0944-Ab | synth-03272+0944-Aa2'],
  [namedRow('multiples:03579+4001-Aa,Ab/Ab', { other: 'multiples:03579+4001-Aa1,Aa2/Aa2' }), 'synth-03579+4001-Ab | synth-03579+4001-Aa2'],
  [namedRow('multiples:04142+2813-Aa,Ab/Ab', { other: 'multiples:04142+2813-Aa1,2/2' }), 'synth-04142+2813-Aa2 | synth-04142+2813-Ab'],
  [namedRow('multiples:04226+2538-Ba,Bb/Bb', { other: 'multiples:04226+2538-Ba1,Ba2/Ba2' }), 'synth-04226+2538-Ba2 | synth-04226+2538-Bb'],
  [namedRow('multiples:04247+0442-AB/B', { other: 'multiples:04247+0442-Aa,Ab/Ab' }), 'synth-04247+0442-Ab | synth-04247+0442-B'],
  [namedRow('multiples:04331+2410-Aa,b1/b1', { other: 'multiples:04331+2410-Aa,b2/b2' }), 'synth-04331+2410-b1 | synth-04331+2410-b2'],
  [namedRow('multiples:05353-0523-Ca,Cb/Cb', { other: 'multiples:05353-0523-Ca1,Ca2/Ca2' }), 'synth-05353-0523-Ca2 | synth-05353-0523-Cb'],
  [namedRow('multiples:05355-0516-Aa,Ab/Ab', { other: 'multiples:05355-0516-Aa1,Aa2/Aa2' }), 'synth-05355-0516-Aa2 | synth-05355-0516-Ab'],
  [namedRow('multiples:06035+1941-AB/B', { other: 'multiples:06035+1941-Aa,Ab/Ab' }), 'synth-06035+1941-Ab | synth-06035+1941-B'],
  [namedRow('multiples:06290+2013-Aa,Ab/Ab', { other: 'multiples:06290+2013-Aa1,2/2' }), 'synth-06290+2013-Aa2 | synth-06290+2013-Ab'],
  [namedRow('multiples:09124-0707-AB/B', { other: 'multiples:09124-0707-Aa,Ab/Ab' }), 'synth-09124-0707-Ab | synth-09124-0707-B'],
  [namedRow('multiples:09276-3500-AB/B', { other: 'multiples:09276-3500-Aa,Ab/Ab' }), 'synth-09276-3500-Ab | synth-09276-3500-B'],
  [namedRow('multiples:10067+1754-Aa,Ab/Ab', { other: 'multiples:10067+1754-Aa,Ac/Ac' }), 'synth-10067+1754-Ac | synth-10067+1754-Ab'],
  [namedRow('multiples:10333+0622-AB/B', { other: 'multiples:10333+0622-AC/C' }), 'synth-10333+0622-B | synth-10333+0622-C'],
  [namedRow('multiples:10444-6000-Aa,Ac/Ac', { other: 'multiples:10444-6000-Aa1,Aa2/Aa2' }), 'synth-10444-6000-Aa2 | synth-10444-6000-Ac'],
  [namedRow('multiples:10465-6416-AB/B', { other: 'multiples:10465-6416-Aa,Ab/Ab' }), 'synth-10465-6416-Ab | synth-10465-6416-B'],
  [namedRow('multiples:11221-2447-Aa,Ab/Ab', { other: 'multiples:11221-2447-Ba,Bb/Bb' }), 'synth-11221-2447-Ab | synth-11221-2447-Bb'],
  [namedRow('multiples:11342+1101-Aa,Ab/Ab', { other: 'multiples:11342+1101-Aa1,Aa2/Aa2' }), 'synth-11342+1101-Aa2 | synth-11342+1101-Ab'],
  [namedRow('multiples:12071+6905-Aa,Ab/Ab', { other: 'multiples:12071+6905-Aa1,Aa2/Aa2' }), 'synth-12071+6905-Ab | synth-12071+6905-Aa2'],
  [namedRow('multiples:12114-1647-Aa,Ab/Ab', { other: 'multiples:12114-1647-Aa1,Aa2/Aa2' }), 'synth-12114-1647-Ab | synth-12114-1647-Aa2'],
  [namedRow('multiples:12115+5325-AC/C', { other: 'multiples:12115+5325-Aa,Ab/Ab' }), 'synth-12115+5325-Ab | synth-12115+5325-C'],
  [namedRow('multiples:13073+0035-AC/C', { other: 'multiples:13073+0035-Aa,Ab/Ab' }), 'synth-13073+0035-C | synth-13073+0035-Ab'],
  [namedRow('multiples:13443-5101-A,Ba/Ba', { other: 'multiples:13443-5101-A,Bb/Bb' }), 'synth-13443-5101-Ba | synth-13443-5101-Bb'],
  [namedRow('multiples:13527-1843-AB/B', { other: 'multiples:13527-1843-Aa,Ab/Ab' }), 'synth-13527-1843-B | synth-13527-1843-Ab'],
  [namedRow('multiples:13562+3627-AC/C', { other: 'multiples:13562+3627-Aa,Ab/Ab' }), 'synth-13562+3627-C | synth-13562+3627-Ab'],
  [namedRow('multiples:14089-4328-AD/D', { other: 'multiples:14089-4328-AE/E' }), 'synth-14089-4328-E | gaia 6097682722176453376'],
  [namedRow('multiples:14191-1322-AB/B', { other: 'multiples:14191-1322-Aa,Ab/Ab' }), 'synth-14191-1322-B | synth-14191-1322-Ab'],
  [namedRow('multiples:14404+2159-Aa,Ab/Ab', { other: 'multiples:14404+2159-Aa1,Aa2/Aa2' }), 'synth-14404+2159-Aa2 | synth-14404+2159-Ab'],
  [namedRow('multiples:15169-6057-Aa,Ab/Ab', { other: 'multiples:15169-6057-Aa1,Aa2/Aa2' }), 'synth-15169-6057-Aa2 | synth-15169-6057-Ab'],
  [namedRow('multiples:15536-3921-AB/B', { other: 'multiples:15536-3921-Aa,Ab/Ab' }), 'synth-15536-3921-Ab | synth-15536-3921-B'],
  [namedRow('multiples:16315-3901-Aa,Ab/Ab', { other: 'multiples:16315-3901-Aa1,Aa2/Aa2' }), 'synth-16315-3901-Aa2 | synth-16315-3901-Ab'],
  [namedRow('multiples:16329+0315-Aa,Ab/Ab', { other: 'multiples:16329+0315-Aa1,Aa2/Aa2' }), 'synth-16329+0315-Aa2 | synth-16329+0315-Ab'],
  [namedRow('multiples:16413-4846-Aa,Ab/Ab', { other: 'multiples:16413-4846-Aa1,Aa2/Aa2' }), 'synth-16413-4846-Ab | synth-16413-4846-Aa2'],
  [namedRow('multiples:16416+3053-AB/B', { other: 'multiples:16416+3053-Aa,Ab/Ab' }), 'synth-16416+3053-B | synth-16416+3053-Ab'],
  [namedRow('multiples:17038-3809-AB/B', { other: 'multiples:17038-3809-Aa,Ab/Ab' }), 'synth-17038-3809-B | synth-17038-3809-Ab'],
  [namedRow('multiples:17336-3706-Aa,Ab/Ab', { other: 'multiples:17336-3706-Aa1,Aa2/Aa2' }), 'synth-17336-3706-Aa2 | synth-17336-3706-Ab'],
  [namedRow('multiples:18024+2050-AB/B', { other: 'multiples:18024+2050-Aa,Ab/Ab' }), 'synth-18024+2050-Ab | synth-18024+2050-B'],
  [namedRow('multiples:18171-5601-AB/B', { other: 'multiples:18171-5601-Aa,Ab/Ab' }), 'synth-18171-5601-Ab | synth-18171-5601-B'],
  [namedRow('multiples:18439-0649-AB/B', { other: 'multiples:18439-0649-Aa,Ab/Ab' }), 'synth-18439-0649-Ab | synth-18439-0649-B'],
  [namedRow('multiples:19294-0703-Aa,Ab/Ab', { other: 'multiples:19294-0703-Aa1,2/2' }), 'synth-19294-0703-Aa2 | synth-19294-0703-Ab'],
  [namedRow('multiples:19407-0037-Aa,Ab/Ab', { other: 'multiples:19407-0037-Aa1,2/2' }), 'synth-19407-0037-Aa2 | synth-19407-0037-Ab'],
  [namedRow('multiples:19448+2916-Aa,Ab/Ab', { other: 'multiples:19448+2916-Aa1,2/2' }), 'synth-19448+2916-Aa2 | synth-19448+2916-Ab'],
  [namedRow('multiples:19512-7248-AD/D', { other: 'multiples:19512-7248-Aa,Ab/Ab' }), 'synth-19512-7248-D | synth-19512-7248-Ab'],
  [namedRow('multiples:19572+4022-Ba,Bb/Bb', { other: 'multiples:19572+4022-Ba1,Ba2/Ba2' }), 'synth-19572+4022-Bb | synth-19572+4022-Ba2'],
  [namedRow('multiples:23026+2948-AC/C', { other: 'multiples:23026+2948-Aa,Ab/Ab' }), 'synth-23026+2948-Ab | synth-23026+2948-C'],
]);

export const OVERLAP_INVARIANTS: readonly LineageInvariant[] = [
  namedExceptionsInvariant(
    OVERLAP_CODES, 'inside',
    'no record is drawn inside another outside an orbit chain but the pairs named (README.md#overlap-gate)',
    KNOWN_OVERLAPS, 'key-and-params',
  ),
];

/** One row per pair, keyed on the origin key first in byte order, so a pair keeps its row however the records sort. */
export function overlapLineageLines(
  pairs: readonly (readonly [number, number])[], records: readonly { readonly originKey: string }[],
): LineageLine[] {
  return pairs.map(([a, b]) => {
    const [key, other] = [records[a].originKey, records[b].originKey].sort(compareUtf8);
    return stageLineageLine(OVERLAP_CODES, stageRow(OVERLAP_CODES, key, 'inside', { other }, []));
  });
}
