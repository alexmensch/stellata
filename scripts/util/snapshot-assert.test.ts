import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertOrUpdateSnapshot, snapshotCheck, type SnapshotAssertion } from './snapshot-assert';

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

  describe('snapshotCheck', () => {
    it('answers pass, fail and refresh without touching the file', () => {
      writeFileSync(path, JSON.stringify({ n: 1 }));
      expect(snapshotCheck(spec({ n: 1 })).kind).toBe('pass');
      expect(snapshotCheck(spec({ n: 2 })).kind).toBe('fail');
      process.env[ENV] = '1';
      expect(snapshotCheck(spec({ n: 2 }))).toEqual({
        kind: 'refresh', path, text: `${JSON.stringify({ n: 2 }, null, 2)}\n`,
      });
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ n: 1 });
    });

    it('fails on a missing snapshot without the update flag', () => {
      const check = snapshotCheck(spec({ n: 1 }));
      expect(check.kind).toBe('fail');
      expect(check.kind === 'fail' && check.message).toContain(`${ENV}=1 build`);
    });
  });
});
