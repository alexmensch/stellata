import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { blobsAt } from './git-provenance';

describe('blobsAt', () => {
  let root: string;
  let commit: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const binary = Buffer.from([0x00, 0x0a, 0xff, 0x0a, 0x0a, 0x41]);

  beforeAll(() => {
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    root = mkdtempSync(join(tmpdir(), 'blobs-at-'));
    git('init', '-q');
    writeFileSync(join(root, 'empty.tsv'), '');
    writeFileSync(join(root, 'lines.tsv'), 'a\nb\n\n');
    writeFileSync(join(root, 'binary.bin'), binary);
    writeFileSync(join(root, 'no newline.txt'), 'tail');
    mkdirSync(join(root, 'dir'));
    writeFileSync(join(root, 'dir', 'inner.tsv'), 'i\n');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
    commit = git('rev-parse', 'HEAD');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('reads each path in order, absent ones between present ones, bytes exact', () => {
    const paths = ['nowhere.tsv', 'lines.tsv', 'empty.tsv', 'gone/also.tsv', 'binary.bin', 'no newline.txt', 'lines.tsv'];
    const text = (path: string): string | null => {
      const at = blobsAt(commit, paths, root).get(path)!;
      return at.kind === 'absent' ? null : at.bytes.toString('latin1');
    };
    expect(paths.map(text)).toEqual([null, 'a\nb\n\n', '', null, binary.toString('latin1'), 'tail', 'a\nb\n\n']);
  });

  it('answers nothing for no paths, without asking git', () => {
    expect(blobsAt('not-a-commit', [], root).size).toBe(0);
  });

  it('throws for a commit git cannot find, rather than calling every path absent', () => {
    expect(() => blobsAt('0'.repeat(40), ['lines.tsv'], root)).toThrow(/no commit/);
    expect(() => blobsAt('no-such-ref', ['lines.tsv'], root)).toThrow(/no commit/);
  });

  it('throws for a path that names a folder', () => {
    expect(() => blobsAt(commit, ['dir'], root)).toThrow(/dir is not a file/);
  });
});
