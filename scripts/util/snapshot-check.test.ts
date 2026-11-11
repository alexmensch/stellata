import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PIPELINE_STEP_ENV, UPDATE_SNAPSHOTS_ENV as ENV, snapshotCheck, type SnapshotCheckSpec,
} from './snapshot-check';

describe('snapshotCheck', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    delete process.env[ENV];
    dir = mkdtempSync(join(tmpdir(), 'snapshot-check-'));
    path = join(dir, 'expected.json');
  });

  afterEach(() => {
    delete process.env[ENV];
    rmSync(dir, { recursive: true, force: true });
  });

  function spec(actual: { n: number }): SnapshotCheckSpec<{ n: number }> {
    return {
      snapshotPath: path,
      actual,
      compare: (e, a) => ({ drifted: e.n !== a.n, report: `${e.n} vs ${a.n}` }),
      failureLabel: 'test',
      script: 'build',
    };
  }

  it('passes when the snapshot matches, carrying the report', () => {
    writeFileSync(path, JSON.stringify({ n: 1 }));
    expect(snapshotCheck(spec({ n: 1 }))).toEqual({ kind: 'pass', report: '1 vs 1' });
  });

  it('fails on drift, naming the refresh command', () => {
    writeFileSync(path, JSON.stringify({ n: 1 }));
    const check = snapshotCheck(spec({ n: 2 }));
    expect(check.kind).toBe('fail');
    expect(check.kind === 'fail' && check.message).toContain(`${ENV}=1 pnpm run build`);
  });

  it('names the runner flag when the runner runs the step, since it drops the inherited variable', () => {
    writeFileSync(path, JSON.stringify({ n: 1 }));
    process.env[PIPELINE_STEP_ENV] = 'build';
    try {
      const check = snapshotCheck(spec({ n: 2 }));
      expect(check.kind === 'fail' && check.message).toContain('pnpm run build --update-snapshots');
    } finally {
      delete process.env[PIPELINE_STEP_ENV];
    }
  });

  it('fails on a missing snapshot without the update flag', () => {
    expect(snapshotCheck(spec({ n: 1 })).kind).toBe('fail');
  });

  it('answers a refresh under the update flag, missing snapshot included, and writes nothing', () => {
    process.env[ENV] = '1';
    expect(snapshotCheck(spec({ n: 1 }))).toEqual({
      kind: 'refresh', path, text: `${JSON.stringify({ n: 1 }, null, 2)}\n`,
    });
    writeFileSync(path, JSON.stringify({ n: 1 }));
    expect(snapshotCheck(spec({ n: 2 }))).toMatchObject({ kind: 'refresh' });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ n: 1 });
  });

  it('shapes a refresh through refreshTransform, handed null when no snapshot exists', () => {
    process.env[ENV] = '1';
    const seen: ({ n: number } | null)[] = [];
    const transformed = (actual: { n: number }): SnapshotCheckSpec<{ n: number }> => ({
      ...spec(actual),
      refreshTransform: (e, a) => {
        seen.push(e);
        return { n: a.n * 10 };
      },
    });
    expect(snapshotCheck(transformed({ n: 1 }))).toMatchObject({ text: `${JSON.stringify({ n: 10 }, null, 2)}\n` });
    writeFileSync(path, JSON.stringify({ n: 7 }));
    snapshotCheck(transformed({ n: 2 }));
    expect(seen).toEqual([null, { n: 7 }]);
  });
});
