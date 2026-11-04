// A run file's on-disk encoding: README.md#files.

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

export const RUN_FILE_SUFFIX = '.json.gz';

const GZIP_MAGIC = [0x1f, 0x8b] as const;

export function runFilePathError(flag: string, path: string): string | null {
  return path.endsWith(RUN_FILE_SUFFIX)
    ? null
    : `${flag} ${path}: a run file is written gzipped, so its path must end ${RUN_FILE_SUFFIX}`;
}

export function writeRunFile(path: string, value: unknown): void {
  const error = runFilePathError('run file', path);
  if (error !== null) throw new Error(error);
  writeFileSync(path, gzipSync(`${JSON.stringify(value, null, 2)}\n`));
}

export function readJsonFile(path: string): unknown {
  const bytes = readFileSync(path);
  const gzipped = bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
  return JSON.parse((gzipped ? gunzipSync(bytes) : bytes).toString('utf-8'));
}
