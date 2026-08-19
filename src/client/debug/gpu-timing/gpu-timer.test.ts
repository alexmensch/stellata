import { describe, it, expect } from 'vitest';
import { GPU_WHOLE_FRAME_SCOPE, GpuTimer } from './gpu-timer';
import { FakeGl, asGl } from './fake-gl';

function drain(t: GpuTimer): { label: string; ms: number }[] {
  const out: { label: string; ms: number }[] = [];
  t.advanceFrame((label, ms) => out.push({ label, ms }));
  return out;
}

describe('GpuTimer', () => {
  it('create() returns null when the extension is absent', () => {
    const gl = new FakeGl();
    gl.hasExtension = false;
    expect(GpuTimer.create(asGl(gl))).toBeNull();
  });

  it('times one scope per frame and rotates — the extension allows no nesting', () => {
    const gl = new FakeGl();
    const t = GpuTimer.create(asGl(gl))!;

    // Frame 1: 'main' is registered first so it owns the slot;
    // 'localDepth' registers but must NOT start a concurrent query.
    expect(t.begin('main')).toBe(true);
    t.end('main');
    expect(t.begin('localDepth')).toBe(false);
    t.end('localDepth');
    expect(gl.created).toBe(1);
    expect(t.scopeLabels()).toEqual(['main', 'localDepth']);
    drain(t);

    // Frame 2: the rotation has moved on, so 'localDepth' gets the slot.
    expect(t.begin('main')).toBe(false);
    t.end('main');
    expect(t.begin('localDepth')).toBe(true);
    t.end('localDepth');
    expect(gl.created).toBe(2);
  });

  it('reports a result in ms only once the query resolves, and only once', () => {
    const gl = new FakeGl();
    const t = GpuTimer.create(asGl(gl))!;
    t.begin('main');
    const query = gl.activeQuery!;
    t.end('main');

    // Still in flight — nothing drains.
    expect(drain(t)).toEqual([]);

    gl.results.set(query, 4_500_000);
    expect(drain(t)).toEqual([{ label: 'main', ms: 4.5 }]);
    // Drained once only.
    expect(drain(t)).toEqual([]);
  });

  it('discards results when the driver reports a disjoint event', () => {
    const gl = new FakeGl();
    const t = GpuTimer.create(asGl(gl))!;
    t.begin('main');
    const query = gl.activeQuery!;
    t.end('main');
    gl.results.set(query, 9_000_000);
    gl.disjoint = true;

    expect(drain(t)).toEqual([]);
    // The query is still retired (not leaked) despite the discard.
    expect(gl.created).toBe(1);
    t.begin('main');
    expect(gl.created).toBe(1);
  });

  it('recycles query objects instead of allocating one per frame', () => {
    const gl = new FakeGl();
    const t = GpuTimer.create(asGl(gl))!;
    for (let f = 0; f < 5; f++) {
      t.begin('main');
      const q = gl.activeQuery!;
      t.end('main');
      gl.results.set(q, 1_000_000);
      drain(t);
    }
    expect(gl.created).toBe(1);
  });

  it('an enclosing whole-frame scope is not retired by the inner scopes ending inside it', () => {
    const gl = new FakeGl();
    const t = GpuTimer.create(asGl(gl))!;

    // Mirrors the animate() call order: the whole-frame scope brackets
    // both inner scopes. endQuery takes no query handle, so an inner end
    // that closed on a label mismatch would stop the enclosing clock early
    // and the headline would report a fraction of the frame.
    expect(t.begin(GPU_WHOLE_FRAME_SCOPE)).toBe(true);
    const wholeFrame = gl.activeQuery!;
    expect(t.begin('main')).toBe(false);
    t.end('main');
    expect(gl.activeQuery).toBe(wholeFrame);
    expect(t.begin('localDepth')).toBe(false);
    t.end('localDepth');
    expect(gl.activeQuery).toBe(wholeFrame);
    t.end(GPU_WHOLE_FRAME_SCOPE);
    expect(gl.activeQuery).toBeNull();

    gl.results.set(wholeFrame, 12_000_000);
    expect(drain(t)).toEqual([{ label: GPU_WHOLE_FRAME_SCOPE, ms: 12 }]);
  });

  it('rotates through all three scopes, each sampling once per three frames', () => {
    const gl = new FakeGl();
    const t = GpuTimer.create(asGl(gl))!;
    const sampled: string[] = [];

    for (let f = 0; f < 3; f++) {
      const started = (label: string): void => {
        if (!t.begin(label)) return;
        sampled.push(label);
        gl.results.set(gl.activeQuery!, 1_000_000);
      };
      started(GPU_WHOLE_FRAME_SCOPE);
      started('main');
      t.end('main');
      started('localDepth');
      t.end('localDepth');
      t.end(GPU_WHOLE_FRAME_SCOPE);
      drain(t);
    }

    expect(sampled).toEqual([GPU_WHOLE_FRAME_SCOPE, 'main', 'localDepth']);
  });

  it('dispose deletes in-flight, pooled, and active queries', () => {
    const gl = new FakeGl();
    const t = GpuTimer.create(asGl(gl))!;
    t.begin('main');
    const inFlight = gl.activeQuery!;
    t.end('main');
    t.begin('main');
    const active = gl.activeQuery!;

    t.dispose();
    expect(gl.deleted).toContain(inFlight);
    expect(gl.deleted).toContain(active);
    expect(gl.activeQuery).toBeNull();
    expect(t.scopeLabels()).toEqual([]);
  });
});
