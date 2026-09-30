import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitFiles, presentFiles } from './git-files';

describe('gitFiles + presentFiles', () => {
  let root: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'git-files-'));
    git('init', '-q');
    writeFileSync(join(root, 'kept.md'), 'a');
    writeFileSync(join(root, 'deleted.md'), 'b');
    symlinkSync('kept.md', join(root, 'link.md'));
    git('add', '.');
    unlinkSync(join(root, 'deleted.md'));
    writeFileSync(join(root, 'untracked.md'), 'c');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('lists a tracked file deleted but not staged, and untracked files only on request', () => {
    expect(gitFiles(root).sort()).toEqual(['deleted.md', 'kept.md', 'link.md']);
    expect(gitFiles(root, [], { untracked: true }).sort()).toEqual(['deleted.md', 'kept.md', 'link.md', 'untracked.md']);
  });

  it('keeps only regular files that exist on disk', () => {
    expect(presentFiles(root, gitFiles(root, [], { untracked: true })).sort()).toEqual(['kept.md', 'untracked.md']);
  });
});
