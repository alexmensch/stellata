// A release version and its tag, and the release a commit builds on: the newest release tag reachable from it. See README.md.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

export const TAG_PREFIX = 'v';
/** `git describe --match` / `git tag --list` glob for a release tag. */
export const TAG_GLOB = `${TAG_PREFIX}[0-9]*`;

export const tagOf = (version: string): string => `${TAG_PREFIX}${version}`;

export function parseVersion(version: string): [number, number, number] {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (parts === null) throw new Error(`not a release version: '${version}'`);
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

export function versionOfTag(tag: string): string {
  const version = tag.startsWith(TAG_PREFIX) ? tag.slice(TAG_PREFIX.length) : '';
  parseVersion(version);
  return version;
}

const git = (cwd: string, ...argv: string[]): string =>
  execFileSync('git', argv, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Throws where git has no release tag to reach: a shallow clone, or tags never fetched. */
function releaseTagAt(ref: string, cwd: string): string {
  try {
    return git(cwd, 'describe', '--tags', '--abbrev=0', '--match', TAG_GLOB, ref);
  } catch (err) {
    throw new Error(
      `no release tag reachable from ${ref}: fetch tags and full history (git fetch --tags --unshallow)\n${(err as Error).message}`,
    );
  }
}

export function releaseAt(ref = 'HEAD', cwd = ROOT): string {
  return versionOfTag(releaseTagAt(ref, cwd));
}

/** The commit the newest release reachable from `ref` was cut at: where the next release plan starts. */
export function releaseCommitAt(ref = 'HEAD', cwd = ROOT): string {
  return git(cwd, 'rev-list', '-n', '1', releaseTagAt(ref, cwd));
}
