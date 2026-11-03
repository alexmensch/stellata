// The esbuild import closure of a step's entry files, and the tracked-file listing beside it. See README.md.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { build, type Metafile } from 'esbuild';

import { PACKAGE_JSON, REPO_ROOT } from './paths';

export function packageScripts(): Record<string, string> {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, PACKAGE_JSON), 'utf-8')).scripts;
}

/** Repo-relative path of every module the given entry files import, the entries included. */
export async function entryClosure(entries: readonly string[]): Promise<Set<string>> {
  return new Set(Object.keys((await entryMetafile(entries)).inputs));
}

/** esbuild's metafile over the entries: every module reached, keyed repo-relative, with its imports. */
export async function entryMetafile(entries: readonly string[]): Promise<Metafile> {
  const { metafile } = await build({
    entryPoints: [...entries],
    absWorkingDir: REPO_ROOT,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    metafile: true,
    write: false,
    outdir: 'unwritten',
    logLevel: 'silent',
  });
  return metafile;
}

export function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter((path) => path !== '');
}
