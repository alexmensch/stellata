// Whether this browser can run the WebGPU renderer at all. Capability
// only — never user-agent. See README.md § Two ways to fail, one page.

/** `navigator.gpu` as far as the probe uses it — declaring it structurally
 *  keeps this module off the WebGPU typings, so it stays in the entry
 *  bundle (`../README.md` § Import boundary) where the gate needs it. */
interface GpuCapableNavigator {
  gpu?: { requestAdapter(): Promise<unknown> };
}

export type WebGpuVerdict =
  /** The API is there and an adapter came back. */
  | 'supported'
  /** No `navigator.gpu` — the browser has no WebGPU at all. */
  | 'no-api'
  /** The API is there and still yielded no adapter: a blocklisted driver,
   *  a flag left off, a headless or software context that refused. */
  | 'no-adapter';

/** Ask the browser, never infer from its name. Why a rejection is a
 *  verdict rather than a throw: README.md § Two ways to fail, one page. */
export async function detectWebGpuSupport(
  nav: GpuCapableNavigator = navigator as GpuCapableNavigator,
): Promise<WebGpuVerdict> {
  const gpu = nav.gpu;
  if (gpu === undefined || gpu === null) return 'no-api';
  try {
    const adapter = await gpu.requestAdapter();
    return adapter === null || adapter === undefined ? 'no-adapter' : 'supported';
  } catch {
    return 'no-adapter';
  }
}
