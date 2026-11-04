import { describe, expect, it } from 'vitest';

import { judgeBaseline, planBaseline, type StageHeader } from './lineage-header-pure';

describe('judgeBaseline', () => {
  const header = (commit: string, dirty = false): StageHeader => ({
    stage: 'demo', version: '1.0.0', commit, dirty, inputHash: 'h', files: { 'demo.tsv.gz': 'f1' },
  });
  const matching = (h: StageHeader) => ({ kind: 'read' as const, header: h, onDisk: h.files });

  it('diffs a baseline built at the merge-base, and nothing when there is none', () => {
    expect(judgeBaseline({ kind: 'checkout', header: matching(header('abc')) }, 'abc', false))
      .toEqual({ kind: 'diff', why: 'merge-base' });
    expect(judgeBaseline({ kind: 'absent' }, 'abc', false)).toEqual({ kind: 'none' });
  });

  it('refuses any other baseline, naming its commit, unless told to accept it', () => {
    const refused = judgeBaseline({ kind: 'checkout', header: matching(header('old')) }, 'abc', false);
    expect(refused.kind).toBe('refused');
    expect(refused.kind === 'refused' && refused.message).toMatch(/built at old, not the merge-base abc/);
    expect(judgeBaseline({ kind: 'checkout', header: matching(header('old')) }, 'abc', true))
      .toEqual({ kind: 'diff', why: 'accepted' });
    expect(judgeBaseline({ kind: 'against', dir: '/elsewhere' }, null, false))
      .toEqual({ kind: 'diff', why: 'against' });
  });

  it('pins a merge-base baseline in lineage.previous: diffs against it and never rotates over it', () => {
    const read = (commit: string, dirty = false) => matching(header(commit, dirty));
    const branchBuild = { kind: 'checkout' as const, header: read('branch') };
    expect(planBaseline(read('abc'), branchBuild, 'abc', false))
      .toEqual({ verdict: { kind: 'diff', why: 'merge-base' }, from: 'previous', rotate: false });
    expect(planBaseline({ kind: 'missing' }, { kind: 'checkout', header: read('abc') }, 'abc', false))
      .toEqual({ verdict: { kind: 'diff', why: 'merge-base' }, from: 'current', rotate: true });
    expect(planBaseline(read('abc', true), branchBuild, 'abc', false))
      .toMatchObject({ verdict: { kind: 'refused' }, from: null, rotate: true });
    expect(planBaseline(read('abc'), { kind: 'against', dir: '/x' }, 'abc', false))
      .toEqual({ verdict: { kind: 'diff', why: 'against' }, from: 'against', rotate: false });
  });

  it('refuses, never crashes on, a header an older build wrote in another shape', () => {
    const verdict = judgeBaseline({ kind: 'checkout', header: { kind: 'unreadable', reason: 'no dirty flag' } }, 'abc', false);
    expect(verdict.kind === 'refused' && verdict.message).toMatch(/header does not read \(no dirty flag\)/);
  });

  it('refuses a merge-base header beside files it did not record, and never pins it', () => {
    const swapped = { kind: 'read' as const, header: header('abc'), onDisk: { 'demo.tsv.gz': 'f2' } };
    const verdict = judgeBaseline({ kind: 'checkout', header: swapped }, 'abc', false);
    expect(verdict.kind === 'refused' && verdict.message)
      .toMatch(/whose demo\.tsv\.gz is not the file its header \(built at abc\) recorded/);
    expect(judgeBaseline({ kind: 'checkout', header: { ...swapped, onDisk: { 'demo.tsv.gz': null } } }, 'abc', false).kind)
      .toBe('refused');
    expect(planBaseline(swapped, { kind: 'checkout', header: matching(header('abc')) }, 'abc', false))
      .toEqual({ verdict: { kind: 'diff', why: 'merge-base' }, from: 'current', rotate: true });
    const dirty = judgeBaseline({ kind: 'checkout', header: { ...swapped, header: header('abc', true) } }, 'abc', false);
    expect(dirty.kind === 'refused' && dirty.message)
      .toMatch(/whose demo\.tsv\.gz is not the file its header \(built at abc with uncommitted edits\) recorded/);
  });

  it('refuses a header that names none, or only some, of the stage\'s files', () => {
    const onDisk = { 'demo.tsv.gz': 'f1', 'identity.tsv.gz': 'i1' };
    const partial = { kind: 'read' as const, header: header('abc'), onDisk };
    const empty = { kind: 'read' as const, header: { ...header('abc'), files: {} }, onDisk };
    for (const read of [partial, empty]) {
      expect(judgeBaseline({ kind: 'checkout', header: read }, 'abc', false).kind).toBe('refused');
    }
    const message = judgeBaseline({ kind: 'checkout', header: partial }, 'abc', false);
    expect(message.kind === 'refused' && message.message).toMatch(/whose identity\.tsv\.gz is not the file/);
  });

  it('refuses a baseline built over uncommitted edits, even at the merge-base', () => {
    const dirty = judgeBaseline({ kind: 'checkout', header: matching(header('abc', true)) }, 'abc', false);
    expect(dirty.kind === 'refused' && dirty.message).toMatch(/built at abc with uncommitted edits/);
    expect(judgeBaseline({ kind: 'checkout', header: matching(header('abc', true)) }, 'abc', true))
      .toEqual({ kind: 'diff', why: 'accepted' });
  });
});
