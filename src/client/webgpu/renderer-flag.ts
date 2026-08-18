// Parse the dual-boot renderer flag from the URL fragment — the one URL
// slot the address-bar writers preserve verbatim (see README.md).

export type RendererKind = 'webgl2' | 'webgpu';

export function parseRendererFlag(hash: string): RendererKind | null {
  const v = new URLSearchParams(hash.replace(/^#/, '')).get('renderer');
  return v === 'webgpu' || v === 'webgl2' ? v : null;
}
