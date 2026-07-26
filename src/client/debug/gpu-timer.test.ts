import { describe, it, expect } from 'vitest';
import { GpuTimer } from './gpu-timer';

const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;
const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;

/** Records the begin/end/delete traffic a real driver would see, and lets
 *  a test decide when each query resolves and whether the GPU reported a
 *  disjoint event. */
class FakeGl {
  readonly QUERY_RESULT = QUERY_RESULT;
  readonly QUERY_RESULT_AVAILABLE = QUERY_RESULT_AVAILABLE;

  hasExtension = true;
  disjoint = false;
  created = 0;
  deleted: object[] = [];
  activeQuery: object | null = null;
  /** Query → elapsed ns once resolved; absent means still in flight. */
  results = new Map<object, number>();

  getExtension(name: string): object | null {
    if (name !== 'EXT_disjoint_timer_query_webgl2' || !this.hasExtension) return null;
    return { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT };
  }

  createQuery(): object {
    this.created++;
    return { id: this.created };
  }

  beginQuery(target: number, query: object): void {
    expect(target).toBe(TIME_ELAPSED_EXT);
    expect(this.activeQuery).toBeNull();
    this.activeQuery = query;
  }

  endQuery(target: number): void {
    expect(target).toBe(TIME_ELAPSED_EXT);
    this.activeQuery = null;
  }

  getQueryParameter(query: object, pname: number): boolean | number {
    if (pname === QUERY_RESULT_AVAILABLE) return this.results.has(query);
    return this.results.get(query) ?? 0;
  }

  getParameter(pname: number): boolean {
    expect(pname).toBe(GPU_DISJOINT_EXT);
    const was = this.disjoint;
    // The real flag clears on read.
    this.disjoint = false;
    return was;
  }

  deleteQuery(query: object): void {
    this.deleted.push(query);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asGl = (f: FakeGl) => f as any as WebGL2RenderingContext;

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
