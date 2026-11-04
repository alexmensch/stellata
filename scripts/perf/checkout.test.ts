import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readJsonFlag } from './checkout';
import { writeRunFile } from './run-file/run-file';
import { PERF_SCHEMA, assertPerfFile } from './schema';

const RUN = { schema: PERF_SCHEMA, run: { startedAt: '2026-11-04T10:00:00.000Z', gpu: null }, scenarios: [] };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkout-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readJsonFlag — what --baseline, --against-pin and perf:pin read through', () => {
  it('reads a gzipped run file', () => {
    const path = join(dir, 'run.json.gz');
    writeRunFile(path, RUN);
    expect(readJsonFlag('--baseline', path, assertPerfFile)).toEqual({ value: RUN, error: null });
  });

  it('names the flag and the schema when the gzipped file is a foreign schema', () => {
    const path = join(dir, 'old.json.gz');
    writeRunFile(path, { ...RUN, schema: 'stellata-perf/1' });
    expect(readJsonFlag('--baseline', path, assertPerfFile).error)
      .toMatch(`--baseline ${path} carries schema "stellata-perf/1", not '${PERF_SCHEMA}'`);
  });

  it('calls a file that is neither JSON nor gzip unreadable or malformed, never a value', () => {
    const path = join(dir, 'torn.json.gz');
    writeFileSync(path, Buffer.from([0x1f, 0x8b, 0x08, 0x00]));
    const read = readJsonFlag('--baseline', path, assertPerfFile);
    expect(read.value).toBeNull();
    expect(read.error).toMatch(/^--baseline unreadable — /);
  });
});
