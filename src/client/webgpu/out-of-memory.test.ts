import { describe, expect, it, vi } from 'vitest';
import {
  allocatesWithinMemory,
  OUT_OF_MEMORY_ERROR_TYPE,
  watchOutOfMemory,
  type ErrorReporter,
  type ErrorScopeDevice,
} from './out-of-memory';

function reporter(): ErrorReporter & { logged: string[] } {
  const logged: string[] = [];
  return { logged, onError(report) { logged.push(report.type); } };
}

describe('watchOutOfMemory', () => {
  it('tells every subscriber about an out-of-memory report', () => {
    const r = reporter();
    const watch = watchOutOfMemory(r);
    const a = vi.fn();
    const b = vi.fn();
    watch.subscribe(a);
    watch.subscribe(b);
    r.onError({ type: OUT_OF_MEMORY_ERROR_TYPE });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('ignores every other error type', () => {
    const r = reporter();
    const watch = watchOutOfMemory(r);
    const listener = vi.fn();
    watch.subscribe(listener);
    r.onError({ type: 'GPUValidationError' });
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps the reporter's own handler running, first", () => {
    const r = reporter();
    const watch = watchOutOfMemory(r);
    const order: string[] = [];
    watch.subscribe(() => order.push(`listener after ${r.logged.length}`));
    r.onError({ type: OUT_OF_MEMORY_ERROR_TYPE });
    expect(r.logged).toEqual([OUT_OF_MEMORY_ERROR_TYPE]);
    expect(order).toEqual(['listener after 1']);
  });

  it('stops notifying an unsubscribed listener', () => {
    const r = reporter();
    const watch = watchOutOfMemory(r);
    const listener = vi.fn();
    const unsubscribe = watch.subscribe(listener);
    unsubscribe();
    r.onError({ type: OUT_OF_MEMORY_ERROR_TYPE });
    expect(listener).not.toHaveBeenCalled();
  });

  it("restores the reporter's handler on dispose", () => {
    const r = reporter();
    const own = r.onError;
    const watch = watchOutOfMemory(r);
    watch.dispose();
    expect(r.onError).toBe(own);
  });
});

function scopedDevice(popped: unknown): ErrorScopeDevice & { scopes: string[] } {
  const scopes: string[] = [];
  return {
    scopes,
    pushErrorScope(filter) { scopes.push(`push ${filter}`); },
    popErrorScope() {
      scopes.push('pop');
      return Promise.resolve(popped);
    },
  };
}

describe('allocatesWithinMemory', () => {
  it('runs the allocation inside one out-of-memory scope', async () => {
    const device = scopedDevice(null);
    const allocate = () => { device.scopes.push('allocate'); };
    expect(await allocatesWithinMemory(device, allocate)).toBe(true);
    expect(device.scopes).toEqual(['push out-of-memory', 'allocate', 'pop']);
  });

  it('is false when the scope caught an error', async () => {
    expect(await allocatesWithinMemory(scopedDevice({ message: 'oom' }), () => {})).toBe(false);
  });

  it('pops the scope before rethrowing a throw from the allocation', async () => {
    const device = scopedDevice(null);
    await expect(allocatesWithinMemory(device, () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');
    expect(device.scopes).toEqual(['push out-of-memory', 'pop']);
  });
});
