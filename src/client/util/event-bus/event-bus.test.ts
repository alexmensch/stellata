import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './event-bus';

type TestMap = {
  num: number;
  tick: void;
  obj: { id: number };
};

describe('EventBus', () => {
  it('delivers payloads to subscribers of the matching event', () => {
    const bus = new EventBus<TestMap>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('num', a);
    bus.on('obj', b);
    bus.emit('num', 42);
    expect(a).toHaveBeenCalledWith(42);
    expect(b).not.toHaveBeenCalled();
    bus.emit('obj', { id: 7 });
    expect(b).toHaveBeenCalledWith({ id: 7 });
  });

  it('supports payload-less events', () => {
    const bus = new EventBus<TestMap>();
    const fn = vi.fn();
    bus.on('tick', fn);
    bus.emit('tick');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects a payload on a void event and a missing payload on a typed one', () => {
    const bus = new EventBus<TestMap>();
    // @ts-expect-error
    bus.emit('tick', 1);
    // @ts-expect-error
    bus.emit('num');
  });

  it('returns an unsubscribe that detaches the handler', () => {
    const bus = new EventBus<TestMap>();
    const fn = vi.fn();
    const off = bus.on('num', fn);
    bus.emit('num', 1);
    off();
    bus.emit('num', 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('dedupes identical handler references on register', () => {
    const bus = new EventBus<TestMap>();
    const fn = vi.fn();
    bus.on('num', fn);
    bus.on('num', fn);
    bus.emit('num', 9);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is a no-op to emit an event with no subscribers', () => {
    const bus = new EventBus<TestMap>();
    expect(() => bus.emit('num', 1)).not.toThrow();
  });

  it('clear() detaches every subscriber across every event', () => {
    const bus = new EventBus<TestMap>();
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    bus.on('num', a);
    bus.on('tick', b);
    bus.on('obj', c);
    bus.clear();
    bus.emit('num', 1);
    bus.emit('tick');
    bus.emit('obj', { id: 1 });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(c).not.toHaveBeenCalled();
  });

  it('skips a handler removed mid-emit', () => {
    const bus = new EventBus<TestMap>();
    const seen: string[] = [];
    const offB = { fn: () => {} };
    bus.on('num', () => {
      seen.push('a');
      offB.fn();
    });
    offB.fn = bus.on('num', () => {
      seen.push('b');
    });
    bus.emit('num', 0);
    expect(seen).toEqual(['a']);
  });

  it('runs handlers registered mid-emit in the same round', () => {
    // JS Set iteration includes items added after iteration starts. We
    // pin that contract explicitly so a future refactor (e.g. snapshot
    // the Set into an array before iterating) won't silently flip it.
    const bus = new EventBus<TestMap>();
    const seen: string[] = [];
    bus.on('num', () => {
      seen.push('a');
      bus.on('num', () => {
        seen.push('b');
      });
    });
    bus.emit('num', 0);
    expect(seen).toEqual(['a', 'b']);
  });

  // Subscribers are mutually anonymous, so one must not be able to silence
  // the rest. Before this, a throw took every later handler for good.
  it('delivers to the handlers after one that throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bus = new EventBus<TestMap>();
    const seen: string[] = [];
    bus.on('num', () => { seen.push('a'); });
    bus.on('num', () => { throw new Error('boom'); });
    bus.on('num', () => { seen.push('c'); });

    expect(() => bus.emit('num', 1)).not.toThrow();
    expect(seen).toEqual(['a', 'c']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('keeps delivering on later emits after a handler threw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bus = new EventBus<TestMap>();
    const seen: number[] = [];
    bus.on('num', () => { throw new Error('boom'); });
    bus.on('num', (n) => { seen.push(n); });

    bus.emit('num', 1);
    bus.emit('num', 2);
    expect(seen).toEqual([1, 2]);
    warn.mockRestore();
  });
});
