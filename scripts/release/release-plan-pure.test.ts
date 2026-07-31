import { describe, it, expect } from 'vitest';
import {
  planReleases,
  prNumberFromSubject,
  extractReleaseNotes,
  type RangeCommit,
} from './release-plan-pure';

function commit(sha: string, version: string, pr: number | null): RangeCommit {
  return { sha, version, subject: pr === null ? `Some change` : `Some change (#${pr})` };
}

describe('planReleases', () => {
  it('plans one release for a single-commit push that bumps', () => {
    const plan = planReleases('3.9.0', [commit('aaa', '3.10.0', 1)]);
    expect(plan).toEqual([{ sha: 'aaa', tag: 'v3.10.0', version: '3.10.0', prNumber: 1 }]);
  });

  it('plans nothing when the push changes no version', () => {
    const plan = planReleases('3.9.0', [commit('aaa', '3.9.0', 1), commit('bbb', '3.9.0', 2)]);
    expect(plan).toEqual([]);
  });

  it('plans one release per bump in a stacked push, oldest first', () => {
    const plan = planReleases('3.9.0', [
      commit('aaa', '3.10.0', 1),
      commit('bbb', '3.10.1', 2),
      commit('ccc', '3.11.0', 3),
    ]);
    expect(plan.map((r) => r.tag)).toEqual(['v3.10.0', 'v3.10.1', 'v3.11.0']);
    expect(plan.map((r) => r.sha)).toEqual(['aaa', 'bbb', 'ccc']);
    expect(plan.map((r) => r.prNumber)).toEqual([1, 2, 3]);
  });

  it('skips a no-bump commit without disturbing the surrounding bumps', () => {
    const plan = planReleases('3.9.0', [
      commit('aaa', '3.10.0', 1),
      commit('bbb', '3.10.0', 2),
      commit('ccc', '3.10.1', 3),
    ]);
    expect(plan.map((r) => [r.tag, r.sha])).toEqual([
      ['v3.10.0', 'aaa'],
      ['v3.10.1', 'ccc'],
    ]);
  });

  it('still plans earlier bumps when the tip commit does not bump', () => {
    const plan = planReleases('3.9.0', [
      commit('aaa', '3.10.0', 1),
      commit('bbb', '3.11.0', 2),
      commit('ccc', '3.11.0', 3),
    ]);
    expect(plan.map((r) => r.tag)).toEqual(['v3.10.0', 'v3.11.0']);
  });

  it('emits each tag once, at its newest commit, if a version is re-reached', () => {
    const plan = planReleases('3.9.0', [
      commit('aaa', '3.10.0', 1),
      commit('bbb', '3.9.0', 2),
      commit('ccc', '3.10.0', 3),
    ]);
    expect(plan).toEqual([
      { sha: 'bbb', tag: 'v3.9.0', version: '3.9.0', prNumber: 2 },
      { sha: 'ccc', tag: 'v3.10.0', version: '3.10.0', prNumber: 3 },
    ]);
  });

  it('reproduces the seven-PR stack that lost five releases', () => {
    const plan = planReleases('3.9.0', [
      commit('fba2427', '3.10.0', 312),
      commit('1ddf22c', '3.10.1', 326),
      commit('ce6393c', '3.10.2', 329),
      commit('3621008', '3.10.2', 331),
      commit('daace91', '3.10.3', 332),
      commit('510cb86', '3.11.0', 330),
      commit('9d82a0d', '3.12.0', 333),
    ]);
    expect(plan.length).toBe(6);
    expect(plan.map((r) => r.tag)).toEqual([
      'v3.10.0', 'v3.10.1', 'v3.10.2', 'v3.10.3', 'v3.11.0', 'v3.12.0',
    ]);
    expect(plan.map((r) => r.prNumber)).toEqual([312, 326, 329, 332, 330, 333]);
    expect(plan[2].sha).toBe('ce6393c');
  });
});

describe('prNumberFromSubject', () => {
  it('reads the squash-merge suffix', () => {
    expect(prNumberFromSubject('Do the thing (#333)')).toBe(333);
  });

  it('takes the last reference when the subject cites several', () => {
    expect(prNumberFromSubject('Revert #310, superseded by (#312)')).toBe(312);
  });

  it('returns null for a subject with no reference', () => {
    expect(prNumberFromSubject('Merge branch main into feature')).toBeNull();
  });
});

describe('extractReleaseNotes', () => {
  const body = [
    '## Summary',
    'Prose the release page should not carry.',
    '',
    '## Release notes',
    '',
    '### Summary',
    'A thing happened.',
    '',
    '## Testing',
    'Not release notes.',
  ].join('\n');

  it('returns only the release-notes section', () => {
    expect(extractReleaseNotes(body)).toBe('\n### Summary\nA thing happened.\n');
  });

  it('runs to the end of the body when no heading follows', () => {
    const notes = extractReleaseNotes('## Release notes\n### Summary\nLast section.');
    expect(notes).toBe('### Summary\nLast section.');
  });

  it('tolerates CRLF line endings', () => {
    const notes = extractReleaseNotes('## Release notes\r\n### Summary\r\nWindows.\r\n');
    expect(notes).toBe('### Summary\r\nWindows.\r\n');
  });

  it('returns null when the section is missing', () => {
    expect(extractReleaseNotes('## Summary\nNo notes block here.')).toBeNull();
  });

  it('returns null when the section holds only the template comment', () => {
    const templated = '## Release notes\n\n<!-- Summary / New features /\nBugfixes / Changes -->\n';
    expect(extractReleaseNotes(templated)).toBeNull();
  });

  it('keeps prose that merely sits alongside a comment', () => {
    const notes = extractReleaseNotes('## Release notes\n<!-- hint -->\n### Summary\nReal.');
    expect(notes).toBe('\n### Summary\nReal.');
  });

  it('does not match a heading that only starts with the section name', () => {
    expect(extractReleaseNotes('## Release notes policy\nNot the block.')).toBeNull();
  });
});
