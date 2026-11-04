// A run file's on-disk encoding: README.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

export const RUN_FILE_SUFFIX = '.json.gz';

export const RUN_FILE_GZIP_LEVEL = 9;

const GZIP_MAGIC = [0x1f, 0x8b] as const;

declare const runFilePathBrand: unique symbol;
export type RunFilePath = string & { readonly [runFilePathBrand]: true };

export function parseRunFilePath(
  flag: string,
  path: string,
): { readonly path: RunFilePath; readonly error: null } | { readonly path: null; readonly error: string } {
  return path.endsWith(RUN_FILE_SUFFIX)
    ? { path: path as RunFilePath, error: null }
    : { path: null, error: `${flag} ${path}: a run file is written gzipped, so its path must end ${RUN_FILE_SUFFIX}` };
}

export function writeRunFile(path: RunFilePath, value: unknown): void {
  writeFileSync(path, gzipSync(`${JSON.stringify(value, null, 2)}\n`, { level: RUN_FILE_GZIP_LEVEL }));
}

export function readJsonFile(path: string): unknown {
  const bytes = readFileSync(path);
  const gzipped = bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
  return JSON.parse((gzipped ? gunzipSync(bytes) : bytes).toString('utf-8'));
}
