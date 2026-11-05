import { describe, expect, it } from 'vitest';

import type { FileHashes } from '../../../util/build-stamp';
import {
  acceptedFiles, baseAt, differingInputs, judgeBaseline, parseHeader, planBaseline, type BaselineContext,
  type HeaderRead, type InputsAt, type StageHeader,
} from './lineage-header-pure';

const INPUTS: FileHashes = { 'scripts/demo/build.ts': 'code-1', 'scripts/demo/table.tsv': 'table-1' };

/** Each commit's inputs; a path a commit does not hold is null. */
const tree = (commits: Readonly<Record<string, FileHashes>>): InputsAt => (commit, paths) =>
  ({ kind: 'hashed', hashes: Object.fromEntries(paths().map((p) => [p, commits[commit]?.[p] ?? null])) });

const header = (commit: string, inputs: FileHashes = INPUTS): StageHeader => ({
  stage: 'demo', version: '1.0.0', commit, inputs, files: { 'demo.tsv.gz': 'f1' },
});
const intact = (h: StageHeader): HeaderRead => ({ kind: 'read', header: h, onDisk: h.files });
const checkout = (read: HeaderRead) => ({ kind: 'checkout' as const, header: read });

const branch = (commits: Readonly<Record<string, FileHashes>>, paths = Object.keys(INPUTS)): BaselineContext => ({
  base: { kind: 'fixed', commit: 'abc', paths: () => paths }, inputsAt: tree(commits),
});
const BRANCH = branch({ abc: INPUTS });

describe('judgeBaseline — one map comparison', () => {
  it('diffs a baseline whose inputs are the merge-base\'s, and nothing when there is none', () => {
    expect(judgeBaseline(checkout(intact(header('abc'))), BRANCH, false)).toEqual({ kind: 'diff', why: 'matched' });
    expect(judgeBaseline({ kind: 'absent' }, BRANCH, false)).toEqual({ kind: 'none' });
    expect(judgeBaseline({ kind: 'against', dir: '/elsewhere' }, null, false)).toEqual({ kind: 'diff', why: 'against' });
  });

  it('accepts an older commit\'s build from the inputs the merge-base holds, whatever its commit', () => {
    expect(judgeBaseline(checkout(intact(header('old'))), BRANCH, false)).toEqual({ kind: 'diff', why: 'matched' });
  });

  it('refuses a baseline whose inputs differ, naming each differing path, unless told to accept it', () => {
    const moved = branch({ abc: { ...INPUTS, 'scripts/demo/table.tsv': 'table-2' } });
    const refused = judgeBaseline(checkout(intact(header('old'))), moved, false);
    expect(refused.kind === 'refused' && refused.message).toMatch(
      /built at old, whose inputs differ from the merge-base abc's: scripts\/demo\/table\.tsv\. Build the stage/,
    );
    expect(judgeBaseline(checkout(intact(header('old'))), moved, true)).toEqual({ kind: 'diff', why: 'accepted' });
  });

  it('refuses a header built over an edit the merge-base does not hold, at the merge-base commit too', () => {
    const edited = header('abc', { ...INPUTS, 'scripts/demo/build.ts': 'uncommitted' });
    const refused = judgeBaseline(checkout(intact(edited)), BRANCH, false);
    expect(refused.kind === 'refused' && refused.message).toMatch(/differ from the merge-base abc's: scripts\/demo\/build\.ts/);
  });

  it('compares the branch\'s own input paths too: one the baseline never read refuses it', () => {
    const added = branch({ abc: { ...INPUTS, 'scripts/demo/extra.tsv': 'x' } }, [...Object.keys(INPUTS), 'scripts/demo/extra.tsv']);
    const refused = judgeBaseline(checkout(intact(header('old'))), added, false);
    expect(refused.kind === 'refused' && refused.message).toMatch(/: scripts\/demo\/extra\.tsv\./);
  });

  it('refuses a baseline the merge-base build read a file for that the branch deleted', () => {
    const atBase = { abc: { ...INPUTS, 'scripts/demo/gained.tsv': 'g' } };
    const branchInputsOnly = branch(atBase);
    expect(judgeBaseline(checkout(intact(header('old'))), branchInputsOnly, false))
      .toEqual({ kind: 'diff', why: 'matched' });
    const withDeletedSiblings = branch(atBase, [...Object.keys(INPUTS), 'scripts/demo/gained.tsv']);
    const refused = judgeBaseline(checkout(intact(header('old'))), withDeletedSiblings, false);
    expect(refused.kind === 'refused' && refused.message).toMatch(/: scripts\/demo\/gained\.tsv\./);
  });

  it('refuses when the base\'s inputs cannot be hashed', () => {
    const unknown: BaselineContext = { ...BRANCH, inputsAt: () => ({ kind: 'unknown', reason: 'x is git-ignored' }) };
    const refused = judgeBaseline(checkout(intact(header('old'))), unknown, false);
    expect(refused.kind === 'refused' && refused.message)
      .toMatch(/built at old, whose inputs could not be compared with the merge-base abc's: x is git-ignored\./);
  });

  it('refuses with no merge-base, and never crashes on a header an older build wrote in another shape', () => {
    const none = judgeBaseline(checkout(intact(header('abc'))), null, false);
    expect(none.kind === 'refused' && none.message).toMatch(/built at abc, and no merge-base with origin\/main/);
    const old = judgeBaseline(checkout({ kind: 'unreadable', reason: 'header has no input map' }), BRANCH, false);
    expect(old.kind === 'refused' && old.message).toMatch(/header does not read \(header has no input map\)/);
    expect(judgeBaseline(checkout({ kind: 'missing' }), BRANCH, true)).toEqual({ kind: 'diff', why: 'accepted' });
  });

  it('refuses a header beside files it did not record, or that names only some of them', () => {
    const swapped: HeaderRead = { kind: 'read', header: header('abc'), onDisk: { 'demo.tsv.gz': 'f2' } };
    const refused = judgeBaseline(checkout(swapped), BRANCH, false);
    expect(refused.kind === 'refused' && refused.message)
      .toMatch(/whose demo\.tsv\.gz is not the file its header \(built at abc\) recorded/);
    const partial: HeaderRead = { kind: 'read', header: header('abc'), onDisk: { 'demo.tsv.gz': 'f1', 'identity.tsv.gz': 'i1' } };
    const named = judgeBaseline(checkout(partial), BRANCH, false);
    expect(named.kind === 'refused' && named.message).toMatch(/whose identity\.tsv\.gz is not the file/);
  });
});

describe('planBaseline', () => {
  const branchBuild = checkout(intact(header('branch', { ...INPUTS, 'scripts/demo/build.ts': 'code-2' })));

  it('pins a baseline matching the merge-base in lineage.previous: diffs against it and never rotates over it', () => {
    expect(planBaseline(intact(header('old')), branchBuild, BRANCH, false))
      .toEqual({ kind: 'diff', why: 'matched', from: 'previous', rotate: false });
    expect(planBaseline({ kind: 'missing' }, checkout(intact(header('abc'))), BRANCH, false))
      .toEqual({ kind: 'diff', why: 'matched', from: 'current', rotate: true });
    expect(planBaseline(intact(header('old')), { kind: 'against', dir: '/x' }, BRANCH, false))
      .toEqual({ kind: 'diff', why: 'against', from: 'against', rotate: false });
    expect(planBaseline({ kind: 'missing' }, branchBuild, BRANCH, false)).toMatchObject({ kind: 'refused', rotate: true });
  });
});

describe('on main', () => {
  const inHistory = (commit: string) => commit === 'old' || commit === 'abc';
  const main = (commits: Readonly<Record<string, FileHashes>>): BaselineContext => ({
    base: baseAt({ onMainBranch: true, commit: 'abc' }, 'abc', inHistory, () => { throw new Error('branch paths'); }),
    inputsAt: tree(commits),
  });
  const MAIN = main({ old: INPUTS, abc: { ...INPUTS, 'scripts/demo/table.tsv': 'table-2' } });
  const older = checkout(intact(header('old')));

  it('diffs the previous main build against its own commit\'s inputs, though the landing changed them', () => {
    expect(judgeBaseline(older, MAIN, false)).toEqual({ kind: 'diff', why: 'matched' });
    expect(judgeBaseline(older, branch({ abc: { ...INPUTS, 'scripts/demo/table.tsv': 'table-2' } }), false).kind)
      .toBe('refused');
  });

  it('rotates over that build, and never pins one', () => {
    expect(planBaseline(intact(header('old')), older, MAIN, false))
      .toEqual({ kind: 'diff', why: 'matched', from: 'current', rotate: true });
  });

  it('refuses one from outside HEAD\'s history, or whose inputs are not its commit\'s', () => {
    const elsewhere = judgeBaseline(checkout(intact(header('side-branch'))), MAIN, false);
    expect(elsewhere.kind === 'refused' && elsewhere.message).toMatch(/built at side-branch, not a build from HEAD's history/);
    const edited = judgeBaseline(checkout(intact(header('old', { ...INPUTS, 'scripts/demo/build.ts': 'local' }))), MAIN, false);
    expect(edited.kind === 'refused' && edited.message).toMatch(/differ from its commit old's: scripts\/demo\/build\.ts/);
  });

  it('is main exactly on the main branch with HEAD at the merge-base', () => {
    const paths = () => ['p'];
    expect(baseAt({ onMainBranch: true, commit: 'abc' }, 'abc', inHistory, paths)).toEqual({ kind: 'recorded', inHistory });
    expect(baseAt({ onMainBranch: false, commit: 'abc' }, 'abc', inHistory, paths))
      .toEqual({ kind: 'fixed', commit: 'abc', paths });
    expect(baseAt({ onMainBranch: true, commit: 'local' }, 'abc', inHistory, paths).kind).toBe('fixed');
  });
});

describe('acceptedFiles', () => {
  it('hands back the files of the first header whose inputs are the base\'s, and none when none is', () => {
    const pinned = intact({ ...header('old'), files: { 'demo.tsv.gz': 'pinned' } });
    const stale = intact(header('older', { ...INPUTS, 'scripts/demo/table.tsv': 'table-0' }));
    expect(acceptedFiles([pinned, intact(header('abc'))], BRANCH)).toEqual({ 'demo.tsv.gz': 'pinned' });
    expect(acceptedFiles([stale, intact(header('abc'))], BRANCH)).toEqual({ 'demo.tsv.gz': 'f1' });
    expect(acceptedFiles([stale, { kind: 'missing' }], BRANCH)).toBeNull();
  });
});

describe('the header', () => {
  it('reads an absent input as matching an input the base does not hold', () => {
    expect(differingInputs({ a: 'x' }, { a: 'x', b: null }, ['a', 'b'])).toEqual([]);
    expect(differingInputs({ a: 'x', b: null }, { a: 'x' }, ['a', 'b'])).toEqual([]);
    expect(differingInputs({ a: 'x' }, { a: 'y', b: 'z' }, ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('parses the input map, absent inputs included, and refuses a header written in the older shape', () => {
    const h = { ...header('abc', { a: 'x', gone: null }) };
    expect(parseHeader(JSON.stringify(h), 'h.json')).toEqual(h);
    const older = { stage: 'demo', version: '1', commit: 'abc', dirty: false, inputHash: 'h', files: {} };
    expect(() => parseHeader(JSON.stringify(older), 'h.json')).toThrow(/h\.json: header has no input map/);
  });
});
