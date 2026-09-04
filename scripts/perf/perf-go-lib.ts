// The arm marker's name and freshness, parsed out of perf-go-lib.sh so the
// runner cannot drift from the hook that enforces them. README.md § Human-armed.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'perf-go-lib.sh');

function shellScalar(name: string): string {
  const source = readFileSync(LIB_PATH, 'utf-8');
  const hit = new RegExp(`^${name}=(.+)$`, 'm').exec(source);
  if (hit === null) throw new Error(`${name} is not assigned in ${LIB_PATH}`);
  return hit[1].trim();
}

export const PERF_GO_MARKER_NAME = shellScalar('PERF_GO_MARKER_NAME');
export const PERF_GO_MAX_AGE_S = Number(shellScalar('PERF_GO_MAX_AGE_S'));
