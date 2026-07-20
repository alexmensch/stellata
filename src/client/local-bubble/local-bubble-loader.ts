// Parses public/local-bubble.bin (magic LBUB) into a shell mesh.
// See src/client/local-bubble/README.md.

const MAGIC = 0x4c425542; // 'LBUB' big-endian read of bytes L,B,U,B
const HEADER_BYTES = 32;

export interface LocalBubbleMesh {
  /** vertexCount * 3, ICRS pc (Sol origin). */
  positions: Float32Array;
  /** triangle indices into positions. */
  indices: Uint32Array;
  /** Cavity volume centroid, ICRS pc — the build's reference centroid
   *  (header bytes 16–27). The focus-target center. */
  centroidAbs: [number, number, number];
  /** Max wall-vertex distance from the centroid, pc — the framing extent
   *  fed to `viewingDistanceForExtent` so the whole shell fits on focus. */
  extentPc: number;
}

/** Parse the `LBUB` buffer. Throws on a bad magic or a size that doesn't
 *  match the declared vertex/index counts (a truncated or wrong file).
 *  Header bytes 16–27 carry the build's volume centroid — the label
 *  anchors to the silhouette instead, but the focus target uses it as the
 *  shell center. */
export function parseLocalBubble(buffer: ArrayBuffer): LocalBubbleMesh {
  const view = new DataView(buffer);
  // Magic is the ASCII bytes L,B,U,B in file order; read big-endian so
  // the constant reads the same way.
  if (view.getUint32(0, false) !== MAGIC) {
    throw new Error('local-bubble.bin: bad magic (expected LBUB)');
  }
  const vertexCount = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  const posBytes = vertexCount * 3 * 4;
  const idxBytes = indexCount * 4;
  if (buffer.byteLength !== HEADER_BYTES + posBytes + idxBytes) {
    throw new Error('local-bubble.bin: size mismatch (truncated or corrupt)');
  }
  const centroidAbs: [number, number, number] = [
    view.getFloat32(16, true),
    view.getFloat32(20, true),
    view.getFloat32(24, true),
  ];
  const positions = new Float32Array(buffer.slice(HEADER_BYTES, HEADER_BYTES + posBytes));
  const indices = new Uint32Array(buffer.slice(HEADER_BYTES + posBytes));
  let extentSq = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - centroidAbs[0];
    const dy = positions[i + 1] - centroidAbs[1];
    const dz = positions[i + 2] - centroidAbs[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > extentSq) extentSq = d2;
  }
  return { positions, indices, centroidAbs, extentPc: Math.sqrt(extentSq) };
}

/** Fetch + parse the shell mesh. Resolves null when the asset is absent
 *  (the layer is optional — the scene renders fine without it). */
export async function loadLocalBubble(url: string): Promise<LocalBubbleMesh | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return parseLocalBubble(await res.arrayBuffer());
}
