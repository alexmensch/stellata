import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIGURE_PIN_RELATIVE_TOLERANCE, figurePins } from './figure-pins';

const snapshot = (figures: unknown): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'figure-pins-')), 'x-expected.json');
  if (figures !== null) writeFileSync(path, JSON.stringify(figures));
  return path;
};

describe('figurePins', () => {
  it('holds each figure to the relative tolerance, far inside any quoted digit', () => {
    const path = snapshot({ a: 16.36 });
    figurePins(path, false).pin('a', 16.36 * (1 + FIGURE_PIN_RELATIVE_TOLERANCE / 2));
    expect(() => figurePins(path, false).pin('a', 16.36 * (1 + 2 * FIGURE_PIN_RELATIVE_TOLERANCE))).toThrow(
      /figure a measures .* holds 16\.36.*UPDATE_SNAPSHOTS=1/,
    );
  });

  it('fails on a figure the snapshot lacks, naming the refresh', () => {
    expect(() => figurePins(snapshot({}), false).pin('a', 1)).toThrow(/no figure a.*UPDATE_SNAPSHOTS=1/);
    expect(() => figurePins(snapshot(null), false).pin('a', 1)).toThrow(/no figure a/);
  });

  it('refuses a snapshot holding anything but finite numbers, naming the key', () => {
    expect(() => figurePins(snapshot({ a: 1, b: '2' }), false)).toThrow(/figure b is not a finite number/);
    expect(() => figurePins(snapshot({ a: { nested: 1 } }), false)).toThrow(/figure a is not a finite number/);
    expect(() => figurePins(snapshot([1]), false)).toThrow(/one flat object/);
  });

  it('refuses one key pinned twice', () => {
    const pins = figurePins(snapshot({ a: 1 }), false);
    pins.pin('a', 1);
    expect(() => pins.pin('a', 1)).toThrow(/pinned twice/);
  });

  it('lists snapshot keys no pin reached', () => {
    const pins = figurePins(snapshot({ a: 1, b: 2 }), false);
    pins.pin('a', 1);
    expect(pins.unpinned()).toEqual(['b']);
  });

  it('records instead of asserting when updating, and writes sorted, keeping unreached keys', () => {
    const path = snapshot({ z: 9, a: 1 });
    const pins = figurePins(path, true);
    pins.pin('m', 5.5);
    pins.pin('a', 2);
    pins.write();
    expect(readFileSync(path, 'utf8')).toBe('{\n  "a": 2,\n  "m": 5.5,\n  "z": 9\n}\n');
  });

  it('writes nothing when not updating', () => {
    const path = snapshot({ a: 1 });
    const pins = figurePins(path, false);
    pins.pin('a', 1);
    pins.write();
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}');
  });
});
