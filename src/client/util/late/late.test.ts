import { describe, expect, it, vi } from 'vitest';
import { LateCell, lateFromPromise, type SettledState } from './late';

describe('LateCell', () => {
  it('starts pending and notifies nobody', () => {
    const cell = new LateCell<number>();
    const fn = vi.fn();
    cell.observe(fn);
    expect(cell.state()).toEqual({ status: 'pending' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('notifies an observer registered before the value lands', () => {
    const cell = new LateCell<number>();
    const seen: SettledState<number>[] = [];
    cell.observe((s) => seen.push(s));
    cell.land(7);
    expect(seen).toEqual([{ status: 'ready', value: 7 }]);
    expect(cell.state()).toEqual({ status: 'ready', value: 7 });
  });

  it('runs an observer registered after settling immediately', () => {
    const cell = new LateCell<number>();
    cell.conclude();
    const seen: SettledState<number>[] = [];
    cell.observe((s) => seen.push(s));
    expect(seen).toEqual([{ status: 'absent' }]);
  });

  it('re-notifies on every later settle, and not after unsubscribe', () => {
    const cell = new LateCell<number>();
    const seen: SettledState<number>[] = [];
    const off = cell.observe((s) => seen.push(s));
    cell.land(1);
    cell.land(2);
    off();
    cell.conclude();
    expect(seen).toEqual([{ status: 'ready', value: 1 }, { status: 'ready', value: 2 }]);
    expect(cell.state()).toEqual({ status: 'absent' });
  });

  it('reaches every observer when one throws, then rethrows', () => {
    const cell = new LateCell<number>();
    const after = vi.fn();
    cell.observe(() => { throw new Error('boom'); });
    cell.observe(after);
    expect(() => cell.land(3)).toThrow(AggregateError);
    expect(after).toHaveBeenCalledWith({ status: 'ready', value: 3 });
  });
});

describe('lateFromPromise', () => {
  it('lands on resolve', async () => {
    const late = lateFromPromise(Promise.resolve('x'));
    expect(late.state()).toEqual({ status: 'pending' });
    await Promise.resolve();
    expect(late.state()).toEqual({ status: 'ready', value: 'x' });
  });

  it('concludes absent on reject', async () => {
    const late = lateFromPromise(Promise.reject(new Error('gone')));
    await Promise.resolve();
    await Promise.resolve();
    expect(late.state()).toEqual({ status: 'absent' });
  });
});
