// Parses public/cloud-surfaces.bin (magic CSUR) — per-cloud isosurface
// meshes traced from the Edenhofer dust field, keyed by cloud sid.
// Format: scripts/cloud-surfaces/README.md.

const MAGIC = 0x43535552; // 'CSUR' big-endian read of bytes C,S,U,R
const HEADER_BYTES = 16;
const DIR_ENTRY_BYTES = 12;

export interface CloudSurface {
  /** vertexCount * 3, ICRS pc (Sol origin), outward winding. */
  positions: Float32Array;
  /** triangle indices into positions. */
  indices: Uint32Array;
}

/** Parse the `CSUR` buffer into a sid-keyed mesh map. Throws on a bad
 *  magic, version, or a size that doesn't match the directory sums. */
export function parseCloudSurfaces(buffer: ArrayBuffer): Map<number, CloudSurface> {
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== MAGIC) {
    throw new Error('cloud-surfaces.bin: bad magic (expected CSUR)');
  }
  const version = view.getUint32(4, true);
  if (version !== 1) {
    throw new Error(`cloud-surfaces.bin: unsupported version ${version}`);
  }
  const cloudCount = view.getUint32(8, true);
  const dirBytes = cloudCount * DIR_ENTRY_BYTES;
  let blobBytes = 0;
  for (let i = 0; i < cloudCount; i++) {
    const off = HEADER_BYTES + i * DIR_ENTRY_BYTES;
    blobBytes += view.getUint32(off + 4, true) * 12 + view.getUint32(off + 8, true) * 4;
  }
  if (buffer.byteLength !== HEADER_BYTES + dirBytes + blobBytes) {
    throw new Error('cloud-surfaces.bin: size mismatch (truncated or corrupt)');
  }
  const surfaces = new Map<number, CloudSurface>();
  let blobOff = HEADER_BYTES + dirBytes;
  for (let i = 0; i < cloudCount; i++) {
    const off = HEADER_BYTES + i * DIR_ENTRY_BYTES;
    const sid = view.getUint32(off, true);
    const vertexCount = view.getUint32(off + 4, true);
    const indexCount = view.getUint32(off + 8, true);
    const posBytes = vertexCount * 12;
    const positions = new Float32Array(buffer.slice(blobOff, blobOff + posBytes));
    blobOff += posBytes;
    const idxBytes = indexCount * 4;
    const indices = new Uint32Array(buffer.slice(blobOff, blobOff + idxBytes));
    blobOff += idxBytes;
    surfaces.set(sid, { positions, indices });
  }
  return surfaces;
}

/** Fetch + parse the surface meshes. Resolves null when the asset is
 *  absent — every cloud then falls back to its ellipsoid rim shape. */
export async function loadCloudSurfaces(url: string): Promise<Map<number, CloudSurface> | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  return parseCloudSurfaces(await res.arrayBuffer());
}
