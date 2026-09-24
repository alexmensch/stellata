import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearStamp, inputHashes, readStamp, stampIsCurrent, writeStamp,
} from './build-stamp';

describe('build-stamp', () => {
  let dir: string;
  let input: string;
  let output: string;
  let stamp: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'build-stamp-'));
    input = join(dir, 'input.tsv');
    output = join(dir, 'output.bin');
    stamp = join(dir, 'stamps', 'step.json');
    writeFileSync(input, 'a\tb\n');
    writeFileSync(output, 'built');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is stale with no stamp', () => {
    expect(stampIsCurrent(stamp, inputHashes([input]), [output])).toBe(false);
  });

  it('is current once written for unchanged inputs', () => {
    writeStamp(stamp, inputHashes([input]));
    expect(stampIsCurrent(stamp, inputHashes([input]), [output])).toBe(true);
  });

  it('ignores mtime: a touched input with the same content stays current', () => {
    writeStamp(stamp, inputHashes([input]));
    utimesSync(input, new Date(), new Date(Date.now() + 60_000));
    expect(stampIsCurrent(stamp, inputHashes([input]), [output])).toBe(true);
  });

  it('is stale when an input content changes', () => {
    writeStamp(stamp, inputHashes([input]));
    writeFileSync(input, 'a\tc\n');
    expect(stampIsCurrent(stamp, inputHashes([input]), [output])).toBe(false);
  });

  it('is stale when the input set grows', () => {
    writeStamp(stamp, inputHashes([input]));
    const extra = join(dir, 'extra.tsv');
    writeFileSync(extra, 'x');
    expect(stampIsCurrent(stamp, inputHashes([input, extra]), [output])).toBe(false);
  });

  it('records an absent input as null, and its arrival as a change', () => {
    const later = join(dir, 'later.tsv');
    const before = inputHashes([input, later]);
    expect(Object.values(before)).toContain(null);
    writeStamp(stamp, before);
    expect(stampIsCurrent(stamp, inputHashes([input, later]), [output])).toBe(true);
    writeFileSync(later, 'x');
    expect(stampIsCurrent(stamp, inputHashes([input, later]), [output])).toBe(false);
  });

  it('is stale when an output is missing', () => {
    writeStamp(stamp, inputHashes([input]));
    rmSync(output);
    expect(stampIsCurrent(stamp, inputHashes([input]), [output])).toBe(false);
  });

  it('keys hashes independent of argument order and duplicates', () => {
    const other = join(dir, 'other.tsv');
    writeFileSync(other, 'y');
    expect(inputHashes([other, input, other])).toEqual(inputHashes([input, other]));
  });

  it('clearStamp removes the stamp and tolerates its absence', () => {
    writeStamp(stamp, inputHashes([input]));
    clearStamp(stamp);
    expect(existsSync(stamp)).toBe(false);
    expect(readStamp(stamp)).toBeNull();
    expect(() => clearStamp(stamp)).not.toThrow();
  });
});
