// Fans the renderer's uncaptured out-of-memory reports out to subscribers.
// See README.md § Out of memory.

/** The slice of three's `Renderer.onError` report this reads. */
export interface RendererErrorReport {
  readonly type: string;
}

export interface ErrorReporter {
  onError: (report: RendererErrorReport) => void;
}

export interface OutOfMemoryWatch {
  subscribe(listener: () => void): () => void;
  /** Restores the reporter's own handler and drops every listener. */
  dispose(): void;
}

/** three names the report by the error's constructor. */
export const OUT_OF_MEMORY_ERROR_TYPE = 'GPUOutOfMemoryError';

/** The slice of GPUDevice an error scope needs, structurally — the project
 *  pulls in no WebGPU type package (timestamps/timestamp-probe.ts). */
export interface ErrorScopeDevice {
  pushErrorScope(filter: 'out-of-memory'): void;
  popErrorScope(): Promise<unknown>;
}

/** README.md § Out of memory. */
export async function allocatesWithinMemory(
  device: ErrorScopeDevice,
  allocate: () => void,
): Promise<boolean> {
  device.pushErrorScope('out-of-memory');
  try {
    allocate();
  } catch (err) {
    await device.popErrorScope();
    throw err;
  }
  return (await device.popErrorScope()) === null;
}

export function watchOutOfMemory(reporter: ErrorReporter): OutOfMemoryWatch {
  const listeners = new Set<() => void>();
  const previous = reporter.onError;
  reporter.onError = (report) => {
    previous.call(reporter, report);
    if (report.type !== OUT_OF_MEMORY_ERROR_TYPE) return;
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      reporter.onError = previous;
      listeners.clear();
    },
  };
}
