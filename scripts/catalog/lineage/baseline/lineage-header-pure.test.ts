import { describe, expect, it } from 'vitest';

import {
  judgeBaseline, planBaseline, type InputHashAt, type MergeBase, type StageHeader,
} from './lineage-header-pure';

describe('judgeBaseline', () => {
  const header = (commit: string, dirty = false): StageHeader => ({
    stage: 'demo', version: '1.0.0', commit, dirty, inputHash: 'h', files: { 'demo.tsv.gz': 'f1' },
  });
  const matching = (h: StageHeader) => ({ kind: 'read' as const, header: h, onDisk: h.files });
  const base = (commit: string, inputs: InputHashAt): MergeBase => ({ commit, inputHash: () => inputs });
  const BASE = base('abc', { kind: 'hashed', hash: 'other inputs' });

  it('diffs a baseline built at the merge-base, and nothing when there is none', () => {
    expect(judgeBaseline({ kind: 'checkout', header: matching(header('abc')) }, BASE, false))
      .toEqual({ kind: 'diff', why: 'merge-base' });
    expect(judgeBaseline({ kind: 'absent' }, BASE, false)).toEqual({ kind: 'none' });
  });

  it('refuses any other baseline, naming its commit, unless told to accept it', () => {
    const refused = judgeBaseline({ kind: 'checkout', header: matching(header('old')) }, BASE, false);
    expect(refused.kind).toBe('refused');
    expect(refused.kind === 'refused' && refused.message).toMatch(/built at old, not the merge-base abc/);
    expect(judgeBaseline({ kind: 'checkout', header: matching(header('old')) }, BASE, true))
      .toEqual({ kind: 'diff', why: 'accepted' });
    expect(judgeBaseline({ kind: 'against', dir: '/elsewhere' }, null, false))
      .toEqual({ kind: 'diff', why: 'against' });
  });

  it('pins a merge-base baseline in lineage.previous: diffs against it and never rotates over it', () => {
    const read = (commit: string, dirty = false) => matching(header(commit, dirty));
    const branchBuild = { kind: 'checkout' as const, header: read('branch') };
    expect(planBaseline(read('abc'), branchBuild, BASE, false))
      .toEqual({ verdict: { kind: 'diff', why: 'merge-base' }, from: 'previous', rotate: false });
    expect(planBaseline({ kind: 'missing' }, { kind: 'checkout', header: read('abc') }, BASE, false))
      .toEqual({ verdict: { kind: 'diff', why: 'merge-base' }, from: 'current', rotate: true });
    expect(planBaseline(read('abc', true), branchBuild, BASE, false))
      .toMatchObject({ verdict: { kind: 'refused' }, from: null, rotate: true });
    expect(planBaseline(read('abc'), { kind: 'against', dir: '/x' }, BASE, false))
      .toEqual({ verdict: { kind: 'diff', why: 'against' }, from: 'against', rotate: false });
  });

  it('refuses, never crashes on, a header an older build wrote in another shape', () => {
    const verdict = judgeBaseline({ kind: 'checkout', header: { kind: 'unreadable', reason: 'no dirty flag' } }, BASE, false);
    expect(verdict.kind === 'refused' && verdict.message).toMatch(/header does not read \(no dirty flag\)/);
  });

  it('refuses a merge-base header beside files it did not record, and never pins it', () => {
    const swapped = { kind: 'read' as const, header: header('abc'), onDisk: { 'demo.tsv.gz': 'f2' } };
    const verdict = judgeBaseline({ kind: 'checkout', header: swapped }, BASE, false);
    expect(verdict.kind === 'refused' && verdict.message)
      .toMatch(/whose demo\.tsv\.gz is not the file its header \(built at abc\) recorded/);
    expect(judgeBaseline({ kind: 'checkout', header: { ...swapped, onDisk: { 'demo.tsv.gz': null } } }, BASE, false).kind)
      .toBe('refused');
    expect(planBaseline(swapped, { kind: 'checkout', header: matching(header('abc')) }, BASE, false))
      .toEqual({ verdict: { kind: 'diff', why: 'merge-base' }, from: 'current', rotate: true });
    const dirty = judgeBaseline({ kind: 'checkout', header: { ...swapped, header: header('abc', true) } }, BASE, false);
    expect(dirty.kind === 'refused' && dirty.message)
      .toMatch(/whose demo\.tsv\.gz is not the file its header \(built at abc with uncommitted edits\) recorded/);
  });

  it('refuses a header that names none, or only some, of the stage\'s files', () => {
    const onDisk = { 'demo.tsv.gz': 'f1', 'identity.tsv.gz': 'i1' };
    const partial = { kind: 'read' as const, header: header('abc'), onDisk };
    const empty = { kind: 'read' as const, header: { ...header('abc'), files: {} }, onDisk };
    for (const read of [partial, empty]) {
      expect(judgeBaseline({ kind: 'checkout', header: read }, BASE, false).kind).toBe('refused');
    }
    const message = judgeBaseline({ kind: 'checkout', header: partial }, BASE, false);
    expect(message.kind === 'refused' && message.message).toMatch(/whose identity\.tsv\.gz is not the file/);
  });

  it('diffs a baseline from an older commit built from the merge-base\'s inputs, and pins it', () => {
    const same = base('abc', { kind: 'hashed', hash: 'h' });
    const older = matching(header('old'));
    expect(judgeBaseline({ kind: 'checkout', header: older }, same, false))
      .toEqual({ kind: 'diff', why: 'merge-base-inputs' });
    expect(planBaseline(older, { kind: 'checkout', header: matching(header('branch')) }, same, false))
      .toEqual({ verdict: { kind: 'diff', why: 'merge-base-inputs' }, from: 'previous', rotate: false });
    expect(judgeBaseline({ kind: 'checkout', header: matching(header('old', true)) }, same, false).kind)
      .toBe('refused');
  });

  it('refuses an older commit\'s baseline when the merge-base\'s inputs differ or cannot be hashed', () => {
    const older = { kind: 'checkout' as const, header: matching(header('old')) };
    const differ = judgeBaseline(older, BASE, false);
    expect(differ.kind === 'refused' && differ.message)
      .toMatch(/built at old, not the merge-base abc or a build from the inputs it holds\./);
    const unknown = judgeBaseline(older, base('abc', { kind: 'unknown', reason: 'x is git-ignored' }), false);
    expect(unknown.kind === 'refused' && unknown.message)
      .toMatch(/not the merge-base abc \(its inputs could not be compared with the merge-base's: x is git-ignored\)/);
  });

  it('never hashes the merge-base\'s inputs for a header built at it', () => {
    const unasked = { commit: 'abc', inputHash: () => { throw new Error('hashed'); } };
    expect(judgeBaseline({ kind: 'checkout', header: matching(header('abc')) }, unasked, false))
      .toEqual({ kind: 'diff', why: 'merge-base' });
  });

  it('refuses a baseline built over uncommitted edits, even at the merge-base', () => {
    const dirty = judgeBaseline({ kind: 'checkout', header: matching(header('abc', true)) }, BASE, false);
    expect(dirty.kind === 'refused' && dirty.message).toMatch(/built at abc with uncommitted edits/);
    expect(judgeBaseline({ kind: 'checkout', header: matching(header('abc', true)) }, BASE, true))
      .toEqual({ kind: 'diff', why: 'accepted' });
  });
});
