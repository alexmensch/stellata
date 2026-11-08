import { describe, it, expect } from 'vitest';
import {
  bumped,
  declarationOf,
  declarationProblem,
  planReleases,
  prNumberFromSubject,
  extractReleaseNotes,
  parsePlan,
  type CommitRelease,
  type RangeCommit,
} from './release-plan-pure';

const patch: CommitRelease = { kind: 'release', level: 'patch' };
const minor: CommitRelease = { kind: 'release', level: 'minor' };
const major: CommitRelease = { kind: 'release', level: 'major' };
const none: CommitRelease = { kind: 'none' };

function commit(sha: string, release: CommitRelease, pr: number | null): RangeCommit {
  return { sha, release, subject: pr === null ? `Some change` : `Some change (#${pr})` };
}

describe('declarationOf', () => {
  it('reads each level label', () => {
    expect(declarationOf(['release:major'])).toEqual(major);
    expect(declarationOf(['bug', 'release:minor'])).toEqual(minor);
    expect(declarationOf(['release:patch', 'release:patch'])).toEqual(patch);
    expect(declarationOf(['skip-version-bump'])).toEqual(none);
  });

  it('is undeclared with no level label', () => {
    expect(declarationOf([])).toEqual({ kind: 'undeclared' });
    expect(declarationOf(['release:huge', 'docs'])).toEqual({ kind: 'undeclared' });
  });

  it('is conflicting with two level labels, skip included', () => {
    expect(declarationOf(['release:minor', 'skip-version-bump'])).toEqual({
      kind: 'conflicting', labels: ['release:minor', 'skip-version-bump'],
    });
  });

  it('names a problem only for an undeclared or conflicting PR', () => {
    expect(declarationProblem(minor)).toBeNull();
    expect(declarationProblem(none)).toBeNull();
    expect(declarationProblem({ kind: 'undeclared' }))
      .toMatch(/^no release level declared: attach exactly one of release:major, /);
    expect(declarationProblem(declarationOf(['release:patch', 'release:major'])))
      .toMatch(/^release:patch and release:major conflict/);
  });
});

describe('bumped', () => {
  it('bumps each level and resets the ones below it', () => {
    expect(bumped('7.1.15', 'patch')).toBe('7.1.16');
    expect(bumped('7.1.15', 'minor')).toBe('7.2.0');
    expect(bumped('7.1.15', 'major')).toBe('8.0.0');
  });

  it('refuses anything but major.minor.patch', () => {
    expect(() => bumped('7.1', 'patch')).toThrow(/not a release version: '7.1'/);
    expect(() => bumped('7.1.15-rc.1', 'patch')).toThrow(/not a release version/);
  });
});

describe('planReleases', () => {
  it('plans one release for a single commit that declares a level', () => {
    const plan = planReleases('3.9.0', [commit('aaa', minor, 1)]);
    expect(plan).toEqual([{ sha: 'aaa', tag: 'v3.10.0', version: '3.10.0', prNumber: 1 }]);
  });

  it('plans nothing when every commit skips', () => {
    expect(planReleases('3.9.0', [commit('aaa', none, 1), commit('bbb', none, 2)])).toEqual([]);
  });

  it('derives each queued PR’s version from the ones ahead of it, oldest first', () => {
    const plan = planReleases('3.9.0', [
      commit('aaa', patch, 1),
      commit('bbb', none, 2),
      commit('ccc', minor, 3),
      commit('ddd', patch, 4),
      commit('eee', major, 5),
    ]);
    expect(plan.map((r) => [r.tag, r.sha, r.prNumber])).toEqual([
      ['v3.9.1', 'aaa', 1],
      ['v3.10.0', 'ccc', 3],
      ['v3.10.1', 'ddd', 4],
      ['v4.0.0', 'eee', 5],
    ]);
  });

  it('lands two queued PRs that each declare patch as two distinct versions', () => {
    const plan = planReleases('7.1.15', [commit('aaa', patch, 760), commit('bbb', patch, 761)]);
    expect(plan.map((r) => r.version)).toEqual(['7.1.16', '7.1.17']);
  });

  it('keeps a commit’s existing tag and derives the rest from it, so a rerun re-derives nothing', () => {
    const plan = planReleases('3.9.0', [
      commit('aaa', { kind: 'tagged', version: '3.9.1' }, 1),
      commit('bbb', minor, 2),
    ]);
    expect(plan.map((r) => [r.tag, r.sha])).toEqual([['v3.9.1', 'aaa'], ['v3.10.0', 'bbb']]);
  });

  it('throws on a commit that declares no level, naming it', () => {
    expect(() => planReleases('3.9.0', [commit('aaa1234567', patch, 1), commit('bbb7654321', { kind: 'undeclared' }, 2)]))
      .toThrow(/^bbb7654 \(PR #2\): no release level declared/);
    expect(() => planReleases('3.9.0', [commit('ccc7654321', { kind: 'undeclared' }, null)]))
      .toThrow(/^ccc7654 \(no PR in its subject\)/);
  });
});

describe('parsePlan', () => {
  const sha = 'a'.repeat(40);
  const entry = { sha, tag: 'v7.1.16', version: '7.1.16', prNumber: 760 };

  it('round-trips the plan the plan step writes', () => {
    const plan = [entry, { ...entry, tag: 'v7.1.17', version: '7.1.17', prNumber: null }];
    expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
    expect(parsePlan('[]')).toEqual([]);
  });

  it.each([
    ['not an array', '{}', /not an array/],
    ['a short sha', JSON.stringify([{ ...entry, sha: 'abc' }]), /entry 0: sha is not a full commit hash/],
    ['a tag that is not the version’s', JSON.stringify([{ ...entry, tag: 'v7.1.15' }]), /entry 0: tag is not v7\.1\.16/],
    ['a version that is not one', JSON.stringify([{ ...entry, tag: 'v7.1', version: '7.1' }]), /not a release version/],
    ['a fractional PR number', JSON.stringify([{ ...entry, prNumber: 1.5 }]), /prNumber is neither/],
  ])('refuses %s', (_, json, error) => {
    expect(() => parsePlan(json)).toThrow(error);
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
