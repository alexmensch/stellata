import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertOrUpdateSnapshot, type SnapshotAssertion } from './snapshot-assert';

const ENV = 'SNAPSHOT_ASSERT_TEST_UPDATE';

class Exited extends Error {}

describe('assertOrUpdateSnapshot', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'snapshot-assert-'));
    path = join(dir, 'expected.json');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Exited(); });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env[ENV];
    rmSync(dir, { recursive: true, force: true });
  });

  function spec(actual: { n: number }): SnapshotAssertion<{ n: number }> {
    return {
      envVar: ENV,
      snapshotPath: path,
      actual,
      compare: (e, a) => ({ drifted: e.n !== a.n, report: '' }),
      failureLabel: 'test',
      refreshCommand: `${ENV}=1 build`,
    };
  }

  it('passes when the snapshot matches', async () => {
    writeFileSync(path, JSON.stringify({ n: 1 }));
    await assertOrUpdateSnapshot(spec({ n: 1 }));
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('fails on drift', async () => {
    writeFileSync(path, JSON.stringify({ n: 1 }));
    await expect(assertOrUpdateSnapshot(spec({ n: 2 }))).rejects.toBeInstanceOf(Exited);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('fails on a missing snapshot without the update flag, and writes nothing', async () => {
    await expect(assertOrUpdateSnapshot(spec({ n: 1 }))).rejects.toBeInstanceOf(Exited);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(existsSync(path)).toBe(false);
  });

  it('writes a missing snapshot under the update flag', async () => {
    process.env[ENV] = '1';
    await assertOrUpdateSnapshot(spec({ n: 1 }));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ n: 1 });
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('rewrites a drifted snapshot under the update flag', async () => {
    writeFileSync(path, JSON.stringify({ n: 1 }));
    process.env[ENV] = '1';
    await assertOrUpdateSnapshot(spec({ n: 2 }));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ n: 2 });
  });
});
