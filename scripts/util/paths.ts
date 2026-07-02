// Repo-root path + mtime helper shared by TypeScript build scripts.
// See scripts/util/README.md.

import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// scripts/util/paths.ts sits two levels below the repo root
// (repo/scripts/util), matching every scripts/<folder>/*.ts consumer.
export const REPO_ROOT = resolve(__dirname, '..', '..');

export function mtimeIfExists(path: string): number {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}
