import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { maxMtimeOfSources } from './paths';

describe('paths / maxMtimeOfSources', () => {
  let dir: string;
  let older: string;
  let newer: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'maxmtime-'));
    older = join(dir, 'older.txt');
    newer = join(dir, 'newer.txt');
    writeFileSync(older, 'a');
    writeFileSync(newer, 'b');
    utimesSync(older, new Date(1_000), new Date(1_000));
    utimesSync(newer, new Date(2_000), new Date(2_000));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the max mtime across present paths', () => {
    expect(maxMtimeOfSources([older, newer])).toBe(2_000);
  });

  it('ignores missing paths', () => {
    expect(maxMtimeOfSources([join(dir, 'nope.txt'), older])).toBe(1_000);
  });

  it('returns 0 when every path is missing', () => {
    expect(maxMtimeOfSources([join(dir, 'a'), join(dir, 'b')])).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(maxMtimeOfSources([])).toBe(0);
  });
});
