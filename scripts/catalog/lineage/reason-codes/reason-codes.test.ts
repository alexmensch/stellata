import { describe, expect, it } from 'vitest';

import { artifactText, readArtifact } from '../../../util/sources/source';
import { describeCommittedRoundTrip, firstDifferingLine } from '../../../util/tsv/committed-round-trip';
import { fileAtMergeBase } from '../../../util/git-provenance';
import { releaseAt } from '../../../util/release-version';
import { LINEAGE_STAGES } from '../lineage-stages';
import { appendOnlyViolations, reasonCodeList, type ListedCode } from './reason-code-list-pure';
import { LIVE, outcomeCode, refusalCode, stageCodes } from './reason-codes-pure';
import { parseListedCodes, REASON_CODES } from './reason-codes-tsv';

describeCommittedRoundTrip(REASON_CODES);

/** A list new on this branch has an empty base; only a checkout with no
 *  merge-base to read has none. */
function mergeBaseList(): ListedCode[] | null {
  const base = fileAtMergeBase(REASON_CODES.file);
  if (base.kind === 'no-merge-base') return null;
  return base.kind === 'absent' ? [] : parseListedCodes(base.text);
}

describe('the committed reason-code list', () => {
  it('is what every stage\'s declarations generate', () => {
    const committed = artifactText(REASON_CODES);
    const generated = REASON_CODES.serialize(
      reasonCodeList(LINEAGE_STAGES.map((s) => s.codes), readArtifact(REASON_CODES), releaseAt),
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
    kept: outcomeCode(description, 'none', retired ? { kind: 'retired', retiredIn: '2.0.0' } : LIVE),
  });

  it('keeps a listed code\'s first version and gives a new one the tree\'s', () => {
    const first = reasonCodeList([demo('kept')], [], () => '1.0.0');
    expect(first[0]).toMatchObject({ code: 'demo.kept', firstVersion: '1.0.0', status: 'live' });
    expect(reasonCodeList([demo('kept')], first, () => '2.0.0')[0].firstVersion).toBe('1.0.0');
  });

  it('allows live → retired and refuses removal, an edited description and un-retiring', () => {
    const base = reasonCodeList([demo('kept')], [], () => '1.0.0');
    expect(appendOnlyViolations(base, reasonCodeList([demo('kept', true)], base, () => '2.0.0'))).toEqual([]);
    expect(appendOnlyViolations(base, [])).toEqual(['demo.kept was removed or renamed; mark it retired instead']);
    expect(appendOnlyViolations(base, reasonCodeList([demo('edited')], base, () => '2.0.0'))[0])
      .toMatch(/description changed/);
    const retired = reasonCodeList([demo('kept', true)], base, () => '2.0.0');
    expect(appendOnlyViolations(retired, base)[0]).toMatch(/status may only move live → retired/);
  });

  it('refuses a changed role, and reads an older list that predates the role column', () => {
    const base = reasonCodeList([demo('kept')], [], () => '1.0.0');
    const refusal = stageCodes('demo', { kept: refusalCode('kept') });
    expect(appendOnlyViolations(base, reasonCodeList([refusal], base, () => '2.0.0')))
      .toEqual(['demo.kept: role changed from "outcome" to "refused"']);
    const older = 'code\tstage\teffect\tstatus\tretired_in\tfirst_version\tdescription\n'
      + 'demo.kept\tdemo\tnone\tlive\t\t1.0.0\tkept\n';
    const listed = parseListedCodes(older);
    expect(listed).toEqual([{
      code: 'demo.kept', stage: 'demo', effect: 'none', status: 'live', retiredIn: '', firstVersion: '1.0.0', description: 'kept',
    }]);
    expect(appendOnlyViolations(listed, reasonCodeList([refusal], base, () => '2.0.0'))).toEqual([]);
    const blankRole = 'code\tstage\teffect\trole\tstatus\tretired_in\tfirst_version\tdescription\n'
      + 'demo.kept\tdemo\tnone\t\tlive\t\t1.0.0\tkept\n';
    expect(() => parseListedCodes(blankRole)).toThrow();
  });

  it('refuses one code declared by two stages', () => {
    expect(() => reasonCodeList([demo('a'), demo('b')], [], () => '1.0.0')).toThrow(/declared twice/);
  });
});
