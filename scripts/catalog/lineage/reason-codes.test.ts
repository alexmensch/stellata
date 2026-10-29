import { describe, expect, it } from 'vitest';

import { artifactText, readArtifact } from '../../util/sources/source';
import { describeCommittedRoundTrip, firstDifferingLine } from '../../util/tsv/committed-round-trip';
import { fileAtMergeBase, packageVersion } from '../../util/git-provenance';
import { LINEAGE_STAGES } from './lineage-stages';
import { appendOnlyViolations, reasonCodeList, type ReasonCodeEntry } from './reason-code-list-pure';
import { LIVE, stageCodes } from './reason-codes-pure';
import { REASON_CODES } from './reason-codes-tsv';

describeCommittedRoundTrip(REASON_CODES);

/** A list new on this branch has an empty base; only a checkout with no
 *  merge-base to read has none. */
function mergeBaseList(): ReasonCodeEntry[] | null {
  const base = fileAtMergeBase(REASON_CODES.file);
  if (base.kind === 'no-merge-base') return null;
  return base.kind === 'absent' ? [] : REASON_CODES.parse(base.text);
}

describe('the committed reason-code list', () => {
  it('is what every stage\'s declarations generate', () => {
    const committed = artifactText(REASON_CODES);
    const generated = REASON_CODES.serialize(
      reasonCodeList(LINEAGE_STAGES.map((s) => s.codes), readArtifact(REASON_CODES), packageVersion()),
    );
    const diff = firstDifferingLine(committed, generated);
    expect(diff, 'run `pnpm run lineage:codes`').toBeNull();
  });

  it('is append-only against its merge-base copy', ({ skip }) => {
    const base = mergeBaseList();
    if (base === null) {
      skip('no merge-base to read (a shallow clone, or no origin/main)');
      return;
    }
    expect(appendOnlyViolations(base, readArtifact(REASON_CODES))).toEqual([]);
  });
});

describe('reasonCodeList and appendOnlyViolations', () => {
  const demo = (description: string, retired = false) => stageCodes('demo', {
    kept: { description, effect: 'none', status: retired ? { kind: 'retired', retiredIn: '2.0.0' } : LIVE },
  });

  it('keeps a listed code\'s first version and gives a new one the tree\'s', () => {
    const first = reasonCodeList([demo('kept')], [], '1.0.0');
    expect(first[0]).toMatchObject({ code: 'demo.kept', firstVersion: '1.0.0', status: 'live' });
    expect(reasonCodeList([demo('kept')], first, '2.0.0')[0].firstVersion).toBe('1.0.0');
  });

  it('allows live → retired and refuses removal, an edited description and un-retiring', () => {
    const base = reasonCodeList([demo('kept')], [], '1.0.0');
    expect(appendOnlyViolations(base, reasonCodeList([demo('kept', true)], base, '2.0.0'))).toEqual([]);
    expect(appendOnlyViolations(base, [])).toEqual(['demo.kept was removed or renamed; mark it retired instead']);
    expect(appendOnlyViolations(base, reasonCodeList([demo('edited')], base, '2.0.0'))[0])
      .toMatch(/description changed/);
    const retired = reasonCodeList([demo('kept', true)], base, '2.0.0');
    expect(appendOnlyViolations(retired, base)[0]).toMatch(/status may only move live → retired/);
  });

  it('refuses one code declared by two stages', () => {
    expect(() => reasonCodeList([demo('a'), demo('b')], [], '1.0.0')).toThrow(/declared twice/);
  });
});
