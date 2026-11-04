import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readmeTreeFolders } from './readme-trees';

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'readme-trees-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const walked = () => readmeTreeFolders(root).map((d) => relative(root, d)).sort();

describe('readmeTreeFolders', () => {
  it('walks real directories and never descends a symlink, even one that loops', () => {
    mkdirSync(join(root, 'src/a'), { recursive: true });
    mkdirSync(join(root, 'store'));
    symlinkSync(join(root, 'store'), join(root, 'store/store'));
    symlinkSync(join(root, 'store'), join(root, 'src/a/linked'));
    symlinkSync(join(root, 'src'), join(root, 'src/a/up'));
    expect(walked()).toEqual(['src', 'src/a']);
  });

  it('skips excluded names, .ckpt caches and the paper-store path', () => {
    for (const d of ['src/node_modules', 'scripts/out.tsv.ckpt', 'data/papers/pdf', 'docs']) {
      mkdirSync(join(root, d), { recursive: true });
    }
    expect(walked()).toEqual(['data', 'data/papers', 'docs', 'scripts', 'src']);
  });
});
