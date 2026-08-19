// Test-only WebGL2 stand-in for the timer-query surface GpuTimer uses.
// See README.md § GPU timing.

export const TIME_ELAPSED_EXT = 0x88bf;
export const GPU_DISJOINT_EXT = 0x8fbb;
export const QUERY_RESULT = 0x8866;
export const QUERY_RESULT_AVAILABLE = 0x8867;

/** Records the begin/end/delete traffic a real driver would see, and lets
 *  a test decide when each query resolves and whether the GPU reported a
 *  disjoint event. */
export class FakeGl {
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
    if (target !== TIME_ELAPSED_EXT) throw new Error(`unexpected query target ${target}`);
    if (this.activeQuery !== null) throw new Error('concurrent TIME_ELAPSED query');
    this.activeQuery = query;
  }

  endQuery(target: number): void {
    if (target !== TIME_ELAPSED_EXT) throw new Error(`unexpected query target ${target}`);
    this.activeQuery = null;
  }

  getQueryParameter(query: object, pname: number): boolean | number {
    if (pname === QUERY_RESULT_AVAILABLE) return this.results.has(query);
    return this.results.get(query) ?? 0;
  }

  getParameter(pname: number): boolean {
    if (pname !== GPU_DISJOINT_EXT) throw new Error(`unexpected getParameter ${pname}`);
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
export const asGl = (f: FakeGl) => f as any as WebGL2RenderingContext;
