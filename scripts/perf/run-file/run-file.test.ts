import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RUN_FILE_GZIP_LEVEL, RUN_FILE_SUFFIX, parseRunFilePath, readJsonFile, writeRunFile,
} from './run-file';

const RECORD = { schema: 'stellata-perf/2', run: { startedAt: '2026-11-04T10:00:00.000Z' }, scenarios: [] };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'run-file-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the run-file path', () => {
  it('is a .json.gz path', () => {
    expect(RUN_FILE_SUFFIX).toBe('.json.gz');
    expect(parseRunFilePath('--json', '.perf-runs/2026-11-04/x.json.gz'))
      .toEqual({ path: '.perf-runs/2026-11-04/x.json.gz', error: null });
  });

  it('refuses any other suffix, naming the flag and the path', () => {
    for (const path of ['x.json', 'x.gz', 'x', 'x.json.gz.bak']) {
      expect(parseRunFilePath('--json', path)).toEqual({
        path: null, error: `--json ${path}: a run file is written gzipped, so its path must end .json.gz`,
      });
    }
  });
});

describe('writeRunFile', () => {
  it('writes the record as gzipped, indented JSON', () => {
    const path = parseRunFilePath('test', join(dir, `run${RUN_FILE_SUFFIX}`)).path!;
    writeRunFile(path, RECORD);
    expect(gunzipSync(readFileSync(path)).toString('utf-8')).toBe(`${JSON.stringify(RECORD, null, 2)}\n`);
  });

  it('compresses at level 9, the level the archive was gzipped at', () => {
    const path = parseRunFilePath('test', join(dir, `run${RUN_FILE_SUFFIX}`)).path!;
    writeRunFile(path, RECORD);
    expect(RUN_FILE_GZIP_LEVEL).toBe(9);
    expect(readFileSync(path)).toEqual(gzipSync(`${JSON.stringify(RECORD, null, 2)}\n`, { level: 9 }));
  });
});

describe('readJsonFile', () => {
  it('reads back what writeRunFile wrote', () => {
    const path = parseRunFilePath('test', join(dir, `run${RUN_FILE_SUFFIX}`)).path!;
    writeRunFile(path, RECORD);
    expect(readJsonFile(path)).toEqual(RECORD);
  });

  it('reads plain JSON, which is what a pin is', () => {
    const path = join(dir, 'pin.json');
    writeFileSync(path, JSON.stringify(RECORD));
    expect(readJsonFile(path)).toEqual(RECORD);
  });

  it('throws on malformed JSON either way', () => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, '{');
    expect(() => readJsonFile(path)).toThrow(SyntaxError);
  });
});
