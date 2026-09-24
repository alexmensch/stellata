import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  changedSince, clearStamp, fileHashes, readStamp, stampIsCurrent, writeStamp,
} from './build-stamp';

describe('build-stamp', () => {
  let dir: string;
  let input: string;
  let output: string;
  let stamp: string;

  const write = (): void => writeStamp(stamp, fileHashes([input]), [output]);
  const current = (...inputs: string[]): boolean =>
    stampIsCurrent(stamp, fileHashes(inputs.length > 0 ? inputs : [input]));

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
    expect(current()).toBe(false);
  });

  it('is current once written for unchanged inputs and outputs', () => {
    write();
    expect(current()).toBe(true);
  });

  it('ignores mtime: a touched input with the same content stays current', () => {
    write();
    utimesSync(input, new Date(), new Date(Date.now() + 60_000));
    expect(current()).toBe(true);
  });

  it('is stale when an input content changes', () => {
    write();
    writeFileSync(input, 'a\tc\n');
    expect(current()).toBe(false);
  });

  it('is stale when the input set grows', () => {
    write();
    const extra = join(dir, 'extra.tsv');
    writeFileSync(extra, 'x');
    expect(current(input, extra)).toBe(false);
  });

  it('records an absent input as null, and its arrival as a change', () => {
    const later = join(dir, 'later.tsv');
    const before = fileHashes([input, later]);
    expect(Object.values(before)).toContain(null);
    writeStamp(stamp, before, [output]);
    expect(current(input, later)).toBe(true);
    writeFileSync(later, 'x');
    expect(current(input, later)).toBe(false);
  });

  it('is stale when an output is missing', () => {
    write();
    rmSync(output);
    expect(current()).toBe(false);
  });

  it('is stale when an output was rewritten by something other than this build', () => {
    write();
    writeFileSync(output, 'built by another commit');
    expect(current()).toBe(false);
    expect(changedSince(readStamp(stamp)!.outputs)).toHaveLength(1);
  });

  it('reads a stamp without recorded outputs as no stamp', () => {
    mkdirSync(dirname(stamp), { recursive: true });
    writeFileSync(stamp, JSON.stringify({ inputs: fileHashes([input]) }));
    expect(readStamp(stamp)).toBeNull();
    expect(current()).toBe(false);
  });

  it('refuses to stamp a missing output, or no outputs at all', () => {
    rmSync(output);
    expect(() => write()).toThrow(/outputs missing/);
    expect(() => writeStamp(stamp, fileHashes([input]), [])).toThrow(/none given/);
    expect(existsSync(stamp)).toBe(false);
  });

  it('keys hashes independent of argument order and duplicates', () => {
    const other = join(dir, 'other.tsv');
    writeFileSync(other, 'y');
    expect(fileHashes([other, input, other])).toEqual(fileHashes([input, other]));
  });

  it('clearStamp removes the stamp and tolerates its absence', () => {
    write();
    clearStamp(stamp);
    expect(existsSync(stamp)).toBe(false);
    expect(readStamp(stamp)).toBeNull();
    expect(() => clearStamp(stamp)).not.toThrow();
  });
});
