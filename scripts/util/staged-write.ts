// Write beside a target, then rename over it. See README.md (staged-write.ts entry).

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const STAGING_SUFFIX = '.staged';

export const stagedPath = (path: string): string => path + STAGING_SUFFIX;

export function writeStaged(path: string, contents: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(stagedPath(path), contents);
}

export function landStaged(path: string): void {
  renameSync(stagedPath(path), path);
}

export function discardStaged(path: string): void {
  rmSync(stagedPath(path), { force: true });
}
