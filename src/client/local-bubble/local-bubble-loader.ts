// Parses public/local-bubble.bin (magic LBUB) into a shell mesh.
// See src/client/local-bubble/README.md.

const MAGIC = 0x4c425542; // 'LBUB' big-endian read of bytes L,B,U,B
const HEADER_BYTES = 32;

export interface LocalBubbleMesh {
  /** vertexCount * 3, ICRS pc (Sol origin). */
  positions: Float32Array;
  /** triangle indices into positions. */
  indices: Uint32Array;
  /** Volume-centroid ICRS pc (Sol origin) — the label anchor. */
  centroid: readonly [number, number, number];
}

/** Parse the `LBUB` buffer. Throws on a bad magic or a size that doesn't
 *  match the declared vertex/index counts (a truncated or wrong file). */
export function parseLocalBubble(buffer: ArrayBuffer): LocalBubbleMesh {
  const view = new DataView(buffer);
  // Magic is the ASCII bytes L,B,U,B in file order; read big-endian so
  // the constant reads the same way.
  if (view.getUint32(0, false) !== MAGIC) {
    throw new Error('local-bubble.bin: bad magic (expected LBUB)');
  }
  const vertexCount = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  const centroid: [number, number, number] = [
    view.getFloat32(16, true),
    view.getFloat32(20, true),
    view.getFloat32(24, true),
  ];
  const posBytes = vertexCount * 3 * 4;
  const idxBytes = indexCount * 4;
  if (buffer.byteLength !== HEADER_BYTES + posBytes + idxBytes) {
    throw new Error('local-bubble.bin: size mismatch (truncated or corrupt)');
  }
  const positions = new Float32Array(buffer.slice(HEADER_BYTES, HEADER_BYTES + posBytes));
  const indices = new Uint32Array(buffer.slice(HEADER_BYTES + posBytes));
  return { positions, indices, centroid };
}

/** Fetch + parse the shell mesh. Resolves null when the asset is absent
 *  (the layer is optional — the scene renders fine without it). */
export async function loadLocalBubble(url: string): Promise<LocalBubbleMesh | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return parseLocalBubble(await res.arrayBuffer());
}
