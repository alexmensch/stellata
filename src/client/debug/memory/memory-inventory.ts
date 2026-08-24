import * as THREE from 'three';
import type { Stellata } from '../../stellata';
import {
  byBytesDescending,
  formatBytes,
  geometryBytes,
  textureBytes,
  totalBytes,
  typedArrayRows,
  unknownCount,
  type ResidencyRow,
} from './memory-inventory-pure';

// debug.memory() — GPU residency + JS heap inventory. README.md owns what
// is counted, what is not, and how to read the cross-check.

export interface CrossCheck {
  /** What three's own bookkeeping counts as uploaded. */
  rendererGeometries: number;
  rendererTextures: number;
  /** What the scene walk reached. */
  walkedGeometries: number;
  walkedTextures: number;
  /** Uploaded but off-scene — render targets, and anything parented into
   *  a scene the walk does not visit. */
  unaccountedTextures: number;
  unaccountedGeometries: number;
}

export interface JsHeapReading {
  usedBytes: number;
  totalBytes: number;
  limitBytes: number;
}

export interface MemoryInventory {
  gpu: { rows: ResidencyRow[]; totalBytes: number; unknownRows: number };
  heap: { rows: ResidencyRow[]; totalBytes: number; reading: JsHeapReading | null };
  crossCheck: CrossCheck;
}

/** Slash-joined names of an object's named ancestors, nearest last, so a
 *  row says which layer owns the resource rather than just its type. */
function ownerPath(object: THREE.Object3D): string {
  const parts: string[] = [];
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node.name) parts.unshift(node.name);
  }
  parts.push(object.type);
  return parts.join('/');
}

function materialsOf(object: THREE.Object3D): THREE.Material[] {
  const material = (object as Partial<THREE.Mesh>).material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

function eachTexture(material: THREE.Material, visit: (t: THREE.Texture) => void): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) visit(value);
  }
  const uniforms = (material as Partial<THREE.ShaderMaterial>).uniforms;
  if (!uniforms) return;
  for (const uniform of Object.values(uniforms)) {
    const value = uniform?.value;
    if (value instanceof THREE.Texture) visit(value);
    else if (Array.isArray(value)) {
      for (const entry of value) if (entry instanceof THREE.Texture) visit(entry);
    }
  }
}

function walkScene(scene: THREE.Scene): { rows: ResidencyRow[]; geometries: number; textures: number } {
  const rows: ResidencyRow[] = [];
  const seenGeometries = new Set<string>();
  const seenTextures = new Set<string>();

  scene.traverse((object) => {
    const geometry = (object as Partial<THREE.Mesh>).geometry;
    if (geometry && !seenGeometries.has(geometry.uuid)) {
      seenGeometries.add(geometry.uuid);
      const { bytes, detail } = geometryBytes(geometry);
      rows.push({
        label: `${ownerPath(object)} geometry`,
        bytes,
        basis: 'array',
        detail,
      });
    }
    for (const material of materialsOf(object)) {
      eachTexture(material, (texture) => {
        if (seenTextures.has(texture.uuid)) return;
        seenTextures.add(texture.uuid);
        const { bytes, basis, detail } = textureBytes(texture);
        rows.push({
          label: `${ownerPath(object)} ${texture.name || texture.type}`,
          bytes,
          basis,
          detail,
        });
      });
    }
  });

  return { rows, geometries: seenGeometries.size, textures: seenTextures.size };
}

function rendererMemory(stellata: Stellata): { geometries: number; textures: number } {
  const info = (stellata.renderer as { info?: { memory?: { geometries?: number; textures?: number } } }).info;
  return {
    geometries: info?.memory?.geometries ?? 0,
    textures: info?.memory?.textures ?? 0,
  };
}

/** Chrome-only, and coarse: `performance.memory` is quantised and reports
 *  the whole isolate. Null everywhere else — the per-array rows beside it
 *  are the portable half. */
function readJsHeap(): JsHeapReading | null {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  if (!memory) return null;
  return {
    usedBytes: memory.usedJSHeapSize,
    totalBytes: memory.totalJSHeapSize,
    limitBytes: memory.jsHeapSizeLimit,
  };
}

export function collectMemoryInventory(stellata: Stellata): MemoryInventory {
  const walked = walkScene(stellata.sceneGraph);
  const renderer = rendererMemory(stellata);
  const gpuRows = walked.rows.sort(byBytesDescending);

  const heapRows = typedArrayRows(stellata.catalog, 'catalog');
  heapRows.push({
    label: 'localPositions',
    bytes: stellata.localPositions.byteLength,
    basis: 'array',
    detail: 'epoch-advanced duplicate of catalog.positions in the local frame',
  });
  heapRows.sort(byBytesDescending);

  return {
    gpu: {
      rows: gpuRows,
      totalBytes: totalBytes(gpuRows),
      unknownRows: unknownCount(gpuRows),
    },
    heap: {
      rows: heapRows,
      totalBytes: totalBytes(heapRows),
      reading: readJsHeap(),
    },
    crossCheck: {
      rendererGeometries: renderer.geometries,
      rendererTextures: renderer.textures,
      walkedGeometries: walked.geometries,
      walkedTextures: walked.textures,
      unaccountedTextures: Math.max(0, renderer.textures - walked.textures),
      unaccountedGeometries: Math.max(0, renderer.geometries - walked.geometries),
    },
  };
}

function printableRows(rows: readonly ResidencyRow[]): Array<Record<string, string>> {
  return rows.map((row) => ({
    resource: row.label,
    size: formatBytes(row.bytes),
    basis: row.basis,
    detail: row.detail,
  }));
}

export function printMemoryInventory(inventory: MemoryInventory): void {
  const { gpu, heap, crossCheck } = inventory;
  console.log(`GPU residency (scene walk): ${formatBytes(gpu.totalBytes)} over ${gpu.rows.length} resources`);
  console.table(printableRows(gpu.rows));
  if (gpu.unknownRows > 0) {
    console.warn(`${gpu.unknownRows} resource(s) reported no size — counted as 0, not as free.`);
  }
  console.log(
    `Off-scene: ${crossCheck.unaccountedTextures} texture(s) and `
    + `${crossCheck.unaccountedGeometries} geometr(ies) are uploaded but outside the walk `
    + `(render targets, and any pass scene the walk does not visit). `
    + `renderer.info: ${crossCheck.rendererTextures} textures / ${crossCheck.rendererGeometries} geometries; `
    + `walk: ${crossCheck.walkedTextures} / ${crossCheck.walkedGeometries}.`,
  );
  console.log(`JS heap, known typed arrays: ${formatBytes(heap.totalBytes)}`);
  console.table(printableRows(heap.rows));
  if (heap.reading) {
    console.log(
      `performance.memory: used ${formatBytes(heap.reading.usedBytes)} / `
      + `total ${formatBytes(heap.reading.totalBytes)} / limit ${formatBytes(heap.reading.limitBytes)}`,
    );
  } else {
    console.log('performance.memory: unavailable (Chrome-only) — take a heap snapshot instead.');
  }
}
