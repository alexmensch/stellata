// The pipeline's pre-run input hashes, handed to a TypeScript step through a file the environment names. See README.md.

import { readFileSync, writeFileSync } from 'node:fs';

import type { FileHashes } from './build-stamp';

export const STEP_INPUTS_ENV = 'PIPELINE_STEP_INPUTS';

export function writeStepInputs(path: string, inputs: FileHashes): void {
  writeFileSync(path, JSON.stringify(inputs));
}

function isFileHashes(value: unknown): value is FileHashes {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((v) => v === null || typeof v === 'string');
}

/** The input hashes the pipeline took for this step before starting it; throws when the step was started any other way. */
export function stepInputHashes(): FileHashes {
  const path = process.env[STEP_INPUTS_ENV];
  if (path === undefined) throw new Error(`${STEP_INPUTS_ENV} is unset: run this step through its pnpm run target`);
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isFileHashes(parsed)) throw new Error(`${path} is not a path → hash map`);
  return parsed;
}
