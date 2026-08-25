// Parse the dual-boot renderer flag from the URL fragment — the one URL
// slot the address-bar writers preserve verbatim (see README.md).

export type RendererKind = 'webgl2' | 'webgpu';

export function parseRendererFlag(hash: string): RendererKind | null {
  const v = new URLSearchParams(hash.replace(/^#/, '')).get('renderer');
  return v === 'webgpu' || v === 'webgl2' ? v : null;
}

/**
 * `#webgpu-gate=force` — the dev switch that shows the requires-WebGPU
 * page on a browser that supports WebGPU perfectly well.
 *
 * It exists because the page otherwise has no way to be seen before the
 * cutover: WebGL2 is still the default, so no real user reaches it, and a
 * developer on a supporting browser never fails the capability probe. The
 * value is spelled out rather than accepting a bare `#webgpu-gate` so a
 * stray fragment cannot blank the app (`gate/README.md` § Lands dark).
 */
export function parseGateOverride(hash: string): 'force' | null {
  const v = new URLSearchParams(hash.replace(/^#/, '')).get('webgpu-gate');
  return v === 'force' ? 'force' : null;
}
