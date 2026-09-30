// The esbuild import closure of TypeScript entry points, and the tracked-file listing beside it. See README.md.

import { execFileSync } from 'node:child_process';

import { build } from 'esbuild';

import { REPO_ROOT } from './paths';

/** Repo-relative path of every module the entries import, the entries included. */
export async function importClosure(entries: readonly string[]): Promise<Set<string>> {
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
  return new Set(Object.keys(metafile.inputs));
}

export function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter((path) => path !== '');
}
