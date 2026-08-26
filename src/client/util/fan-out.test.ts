import { describe, expect, it } from 'vitest';
import { fanOut } from './fan-out';

describe('fanOut', () => {
  it('runs every item when none throws', () => {
    const seen: number[] = [];
    fanOut('t', [1, 2, 3], (n) => { seen.push(n); });
    expect(seen).toEqual([1, 2, 3]);
  });

  // The property the whole helper exists for: a bare for-of stops here.
  it('still runs the items after one that throws', () => {
    const seen: number[] = [];
    expect(() => fanOut('t', [1, 2, 3], (n) => {
      seen.push(n);
      if (n === 1) throw new Error('boom');
    })).toThrow(AggregateError);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('carries every failure, not just the first', () => {
    let caught: AggregateError | null = null;
    try {
      fanOut('t', [1, 2, 3], (n) => { if (n !== 2) throw new Error(`e${n}`); });
    } catch (err) {
      caught = err as AggregateError;
    }
    expect(caught?.errors.map((e) => (e as Error).message)).toEqual(['e1', 'e3']);
  });

  it('names the fan-out and the count in the aggregate message', () => {
    expect(() => fanOut('setMonochromeAll', [1], () => { throw new Error('x'); }))
      .toThrow(/setMonochromeAll: 1 of the fan-out threw/);
  });

  it('throws nothing for an empty fan-out', () => {
    expect(() => fanOut('t', [], () => { throw new Error('unreachable'); })).not.toThrow();
  });
});
