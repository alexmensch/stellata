// Real GPU-side timing via EXT_disjoint_timer_query_webgl2.
// See src/client/debug/README.md § GPU timing.

/** The scope that brackets a frame's entire GL cost. Summing the other
 *  scopes cannot substitute for it: they sample on different frames, so
 *  their sum is not a frame total and can exceed the frame period. */
export const GPU_WHOLE_FRAME_SCOPE = 'frame';

/** Minimal shape of the extension this module uses. */
interface DisjointTimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

interface PendingQuery {
  label: string;
  query: WebGLQuery;
}

/**
 * One-scope-at-a-time GPU timer.
 *
 * WebGL2's `EXT_disjoint_timer_query_webgl2` permits exactly ONE active
 * `TIME_ELAPSED` query per context and offers no timestamp queries, so
 * scopes cannot nest or run concurrently within a frame. Instead each
 * frame times a single scope and `advanceFrame()` rotates to the next —
 * N scopes therefore sample at 1/N the frame rate, which is why the
 * ring-buffer averages behind this are still meaningful but the
 * per-frame histogram is not driven by it.
 *
 * Results are async: a query resolves some frames after submission, and
 * a driver-reported disjoint event invalidates every result in flight.
 */
export class GpuTimer {
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: DisjointTimerExt;
  private readonly pending: PendingQuery[] = [];
  private readonly pool: WebGLQuery[] = [];
  /** Every scope label seen, in first-seen order — the rotation ring. */
  private readonly order: string[] = [];
  private rotation = 0;
  private activeQuery: WebGLQuery | null = null;
  private activeLabel = '';

  private constructor(gl: WebGL2RenderingContext, ext: DisjointTimerExt) {
    this.gl = gl;
    this.ext = ext;
  }

  /** Null when the extension is unavailable (Safari exposes no timer
   *  query at all) — callers fall back to CPU submission wall-time. */
  static create(gl: WebGL2RenderingContext): GpuTimer | null {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as DisjointTimerExt | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  /** Scope labels this timer rotates through, in rotation order. */
  scopeLabels(): readonly string[] {
    return this.order;
  }

  /** Open a timed scope. No-op unless this scope owns the current frame's
   *  single query slot. Returns whether a query actually started. */
  begin(label: string): boolean {
    if (!this.order.includes(label)) this.order.push(label);
    if (this.activeQuery) return false;
    if (this.order[this.rotation % this.order.length] !== label) return false;
    const query = this.pool.pop() ?? this.gl.createQuery();
    if (!query) return false;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.activeQuery = query;
    this.activeLabel = label;
    return true;
  }

  /** Close the scope opened by the matching `begin` that returned true. */
  end(label: string): void {
    if (!this.activeQuery || this.activeLabel !== label) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push({ label, query: this.activeQuery });
    this.activeQuery = null;
    this.activeLabel = '';
  }

  /**
   * Drain whatever resolved since the last call, handing each result to
   * `sink` in milliseconds, then rotate to the next scope.
   *
   * Reading `GPU_DISJOINT_EXT` clears it, so it is read exactly once per
   * call and applied to every result drained in the same pass — a
   * disjoint event means the GPU was interrupted and all timings in
   * flight are garbage.
   */
  advanceFrame(sink: (label: string, ms: number) => void): void {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (!gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!disjoint) {
        const ns = gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number;
        sink(p.label, ns / 1e6);
      }
      this.pending.splice(i, 1);
      this.pool.push(p.query);
    }
    if (this.order.length > 0) {
      this.rotation = (this.rotation + 1) % this.order.length;
    }
  }

  /** Queries still in flight are deleted too — the results are dropped
   *  with the panel that would have shown them. */
  dispose(): void {
    const gl = this.gl;
    if (this.activeQuery) {
      gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      gl.deleteQuery(this.activeQuery);
      this.activeQuery = null;
    }
    for (const p of this.pending) gl.deleteQuery(p.query);
    for (const q of this.pool) gl.deleteQuery(q);
    this.pending.length = 0;
    this.pool.length = 0;
    this.order.length = 0;
    this.rotation = 0;
  }
}
