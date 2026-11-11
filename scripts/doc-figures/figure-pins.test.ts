import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { figurePins } from './figure-pins';

const snapshot = (figures: Record<string, number> | null): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'figure-pins-')), 'x-expected.json');
  if (figures) writeFileSync(path, JSON.stringify(figures));
  return path;
};

const close = (actual: number, expected: number, digits: number) => expect(actual).toBeCloseTo(expected, digits);

describe('figurePins', () => {
  it('asserts each figure against the snapshot to the stated places', () => {
    const pins = figurePins(snapshot({ a: 22.5304 }), close, false);
    pins.pin('a', 22.5301, 3);
    expect(() => figurePins(snapshot({ a: 22.5304 }), close, false).pin('a', 22.532, 3)).toThrow();
  });

  it('fails on a figure the snapshot lacks, naming the refresh', () => {
    expect(() => figurePins(snapshot({}), close, false).pin('a', 1, 3)).toThrow(/no figure a.*UPDATE_SNAPSHOTS=1/);
    expect(() => figurePins(snapshot(null), close, false).pin('a', 1, 3)).toThrow(/no figure a/);
  });

  it('refuses one key pinned twice', () => {
    const pins = figurePins(snapshot({ a: 1 }), close, false);
    pins.pin('a', 1, 3);
    expect(() => pins.pin('a', 1, 3)).toThrow(/pinned twice/);
  });

  it('lists snapshot keys no pin reached', () => {
    const pins = figurePins(snapshot({ a: 1, b: 2 }), close, false);
    pins.pin('a', 1, 3);
    expect(pins.unpinned()).toEqual(['b']);
  });

  it('records instead of asserting when updating, and writes sorted, keeping unreached keys', () => {
    const path = snapshot({ z: 9, a: 1 });
    const pins = figurePins(path, () => { throw new Error('asserted while updating'); }, true);
    pins.pin('m', 5.5, 3);
    pins.pin('a', 2, 3);
    pins.write();
    expect(readFileSync(path, 'utf8')).toBe('{\n  "a": 2,\n  "m": 5.5,\n  "z": 9\n}\n');
  });

  it('writes nothing when not updating', () => {
    const path = snapshot({ a: 1 });
    const pins = figurePins(path, close, false);
    pins.pin('a', 1, 3);
    pins.write();
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}');
  });
});
