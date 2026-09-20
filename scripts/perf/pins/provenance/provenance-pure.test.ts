import { describe, expect, it } from 'vitest';
import type { GitProvenance } from '../../schema';
import {
  citeRunPath,
  commitStateFromExitStatus,
  parseRenderPathDrift,
  pinProvenanceLines,
} from './provenance-pure';

describe('parseRenderPathDrift', () => {
  it('reads a full shortstat line', () => {
    expect(parseRenderPathDrift(' 42 files changed, 1600 insertions(+), 30 deletions(-)'))
      .toEqual({ files: 42, insertions: 1600, deletions: 30 });
  });

  it('reads a clause git omits when its count is zero', () => {
    expect(parseRenderPathDrift(' 3 files changed, 12 insertions(+)'))
      .toEqual({ files: 3, insertions: 12, deletions: 0 });
    expect(parseRenderPathDrift(' 2 files changed, 7 deletions(-)'))
      .toEqual({ files: 2, insertions: 0, deletions: 7 });
    expect(parseRenderPathDrift(' 1 file changed, 1 insertion(+), 1 deletion(-)'))
      .toEqual({ files: 1, insertions: 1, deletions: 1 });
  });

  it('reads an empty line as a measured zero, not as a failure to measure', () => {
    expect(parseRenderPathDrift('')).toEqual({ files: 0, insertions: 0, deletions: 0 });
    expect(parseRenderPathDrift('\n')).toEqual({ files: 0, insertions: 0, deletions: 0 });
  });

  it('returns null on anything it cannot read', () => {
    expect(parseRenderPathDrift('fatal: bad revision')).toBeNull();
  });
});

describe('commitStateFromExitStatus — only exit 1 is an answer', () => {
  it('reads a clean exit as landed and exit 1 as unlanded', () => {
    expect(commitStateFromExitStatus(0)).toBe('landed');
    expect(commitStateFromExitStatus(1)).toBe('unlanded');
  });

  it('reads every other status as unknown, never as unlanded', () => {
    // 128 is git's "bad object / no such ref".
    for (const status of [128, 129, 2, -1, undefined]) {
      expect(commitStateFromExitStatus(status), `status ${status}`).toBe('unknown');
    }
  });
});

describe('pinProvenanceLines — what the pin measured, before any row is read', () => {
  const onMain: GitProvenance = {
    commit: 'landed7', dirty: false, mainCommit: 'base1234', mainReachable: true,
  };
  const RUN_BASE = 'runbase9';
  const NO_DRIFT = { files: 0, insertions: 0, deletions: 0 };

  it('says nothing when the commit landed and main has not moved under src/client', () => {
    expect(pinProvenanceLines(onMain, 'landed', NO_DRIFT, RUN_BASE)).toEqual([]);
  });

  it('names a pre-squash tip that no hash on main carries', () => {
    const lines = pinProvenanceLines(onMain, 'unlanded', NO_DRIFT, RUN_BASE);
    expect(lines[0]).toContain('not an ancestor of origin/main');
    expect(lines[0]).toContain('pre-squash branch tip');
  });

  it('quotes the render-path difference a mark might really be', () => {
    const lines = pinProvenanceLines(onMain, 'unlanded', { files: 42, insertions: 1600, deletions: 30 }, RUN_BASE);
    expect(lines[1]).toContain('42 files, +1600/-30');
    expect(lines[1]).toContain('may be that difference rather than this diff');
  });

  it('names both bases and the direction, rather than claiming main moved forward', () => {
    const lines = pinProvenanceLines(onMain, 'landed', { files: 3, insertions: 9, deletions: 1 }, RUN_BASE);
    expect(lines[0]).toContain("from the pin's base base1234 to this run's runbase9");
    expect(lines[0]).not.toContain('moved');
  });

  it('still reads without a run base to name', () => {
    const lines = pinProvenanceLines(onMain, 'landed', { files: 3, insertions: 9, deletions: 1 }, null);
    expect(lines[0]).toContain("to this run's unrecorded base");
  });

  it('says so when the pin records no main base at all', () => {
    const based: GitProvenance = { ...onMain, mainCommit: null };
    expect(pinProvenanceLines(based, 'unlanded', null, RUN_BASE).at(-1)).toContain('cannot be measured at all');
  });

  it('separates an unreadable ancestry from a known-unlanded one', () => {
    expect(pinProvenanceLines(onMain, 'unknown', null, RUN_BASE)[0]).toContain('drift is unbounded');
  });
});

describe('citeRunPath — the pin ships in a public repo', () => {
  it('cites a run under the checkout by its repo-relative path', () => {
    expect(citeRunPath('/Users/alexm/github/stellata/.perf-runs/2026-09-05/pin.json', '/Users/alexm/github/stellata'))
      .toBe('.perf-runs/2026-09-05/pin.json');
  });

  it('keeps the name and drops the location of a run stored elsewhere', () => {
    expect(citeRunPath('/tmp/scratch/pin.json', '/Users/alexm/github/stellata')).toBe('pin.json');
  });

  it('cites a worktree run relative to that worktree, not to the main checkout', () => {
    const worktree = '/Users/alexm/github/stellata/.claude/worktrees/topic';
    const run = `${worktree}/.perf-runs/2026-09-19/pin.json`;
    expect(citeRunPath(run, worktree)).toBe('.perf-runs/2026-09-19/pin.json');
    expect(citeRunPath(run, '/Users/alexm/github/stellata'))
      .toBe('.claude/worktrees/topic/.perf-runs/2026-09-19/pin.json');
  });
});

