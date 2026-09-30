import { afterEach, describe, expect, it, vi } from 'vitest';
import { Stellata } from './stellata';

function recordingShell(throwing: string) {
  const calls: string[] = [];
  const member = (field: string) =>
    new Proxy({}, {
      get: (_, method) => () => {
        const call = `${field}.${String(method)}`;
        calls.push(call);
        if (call === throwing) throw new Error(`${call} failed`);
      },
    });
  const shell = new Proxy({}, {
    get: (_, field) => member(String(field)),
    set: () => true,
  });
  return { calls, shell };
}

describe('Stellata.dispose', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs every step after one throws, releasing the device last', () => {
    vi.stubGlobal('window', { removeEventListener: vi.fn() });
    const { calls, shell } = recordingShell('layers.disposeAll');
    expect(() => Stellata.prototype.dispose.call(shell as Stellata)).toThrow(AggregateError);
    const after = calls.slice(calls.indexOf('layers.disposeAll') + 1);
    expect(after).toEqual([
      'floatingOrigin.dispose',
      'localDepthPass.dispose',
      'hdr.dispose',
      'webgpu.dispose',
      'renderer.dispose',
      'bus.clear',
    ]);
  });
});
