import * as THREE from 'three';
import type { NamedScene, Stellata } from '../../stellata';
import {
  byBytesDescending,
  crossCheck,
  formatBytes,
  geometryBytes,
  groupRows,
  textureResidency,
  totalBytes,
  typedArrayRows,
  unknownCount,
  unpricedFields,
  type CrossCheck,
  type ResidencyRow,
  type ResourceCounts,
} from './memory-inventory-pure';

// debug.memory() — GPU residency + JS heap inventory. README.md owns what
// is counted, what is not, and how to read the cross-check.

export interface JsHeapReading {
  usedBytes: number;
  totalBytes: number;
  limitBytes: number;
}

export interface MemoryInventory {
  gpu: { rows: ResidencyRow[]; totalBytes: number; unknownRows: number };
  heap: {
    rows: ResidencyRow[];
    totalBytes: number;
    reading: JsHeapReading | null;
    unpricedFields: string[];
  };
  crossCheck: CrossCheck;
}

/** Slash-joined names of an object's named ancestors, nearest last, then
 *  `leaf`, so a row says which layer owns the resource. */
function ownerPath(object: THREE.Object3D, leaf: string): string {
  const parts: string[] = [];
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node.name) parts.unshift(node.name);
  }
  parts.push(leaf);
  return parts.join('/');
}

function materialsOf(object: THREE.Object3D): THREE.Material[] {
  const material = (object as Partial<THREE.Mesh>).material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

/** What to call a mesh when nothing up its parent chain is named. The
 *  layers name their materials far more consistently than their objects,
 *  and `Object3D.type` alone collapses hundreds of rows onto `Mesh`. */
function leafName(object: THREE.Object3D): string {
  for (const material of materialsOf(object)) {
    if (material.name) return material.name;
  }
  return object.type;
}

/** `Texture.type` is the pixel DATA type — a numeric three constant, not
 *  a readable name the way `Object3D.type` is — so a row keyed on it
 *  prints `1009`. The slot the texture was found under is what actually
 *  identifies it; the class name says which kind of texture it is. */
function textureName(texture: THREE.Texture, slot: string): string {
  if (texture.name) return `${texture.name} (${texture.constructor.name})`;
  return `${slot} (${texture.constructor.name})`;
}

function eachTexture(
  material: THREE.Material,
  visit: (texture: THREE.Texture, slot: string) => void,
): void {
  for (const [slot, value] of Object.entries(material)) {
    if (value instanceof THREE.Texture) visit(value, slot);
  }
  const uniforms = (material as Partial<THREE.ShaderMaterial>).uniforms;
  if (!uniforms) return;
  for (const [slot, uniform] of Object.entries(uniforms)) {
    const value = uniform?.value;
    if (value instanceof THREE.Texture) visit(value, slot);
    else if (Array.isArray(value)) {
      value.forEach((entry, i) => {
        if (entry instanceof THREE.Texture) visit(entry, `${slot}[${i}]`);
      });
    }
  }
}

/** One pass over every scene the shell draws. Dedupe spans the scenes:
 *  a texture shared between the shell's scene and the seam's is one
 *  allocation and gets one row. */
function walkScenes(
  scenes: readonly NamedScene[],
): { rows: ResidencyRow[]; counts: ResourceCounts } {
  const rows: ResidencyRow[] = [];
  const seenGeometries = new Set<string>();
  const seenTextures = new Set<string>();
  const scenePrefix = scenes.length > 1;

  for (const { name, scene } of scenes) {
    const prefix = scenePrefix ? `${name}: ` : '';
    scene.traverse((object) => {
      const owner = ownerPath(object, leafName(object));
      const geometry = (object as Partial<THREE.Mesh>).geometry;
      if (geometry && !seenGeometries.has(geometry.uuid)) {
        seenGeometries.add(geometry.uuid);
        const { bytes, detail } = geometryBytes(geometry);
        rows.push({ label: `${prefix}${owner} geometry`, bytes, basis: 'array', detail });
      }
      for (const material of materialsOf(object)) {
        eachTexture(material, (texture, slot) => {
          if (seenTextures.has(texture.uuid)) return;
          seenTextures.add(texture.uuid);
          const { bytes, basis, detail } = textureResidency(texture);
          rows.push({
            label: `${prefix}${owner} ${textureName(texture, slot)}`,
            bytes,
            basis,
            detail,
          });
        });
      }
    });
  }

  return {
    rows,
    counts: { geometries: seenGeometries.size, textures: seenTextures.size },
  };
}

function rendererCounts(stellata: Stellata): ResourceCounts {
  const info = (stellata.renderer as {
    info?: { memory?: { geometries?: number; textures?: number } };
  }).info;
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
  const walked = walkScenes(stellata.sceneGraphs);
  const gpuRows = groupRows(walked.rows).sort(byBytesDescending);

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
      unpricedFields: unpricedFields(stellata.catalog).map((name) => `catalog.${name}`),
    },
    crossCheck: crossCheck(rendererCounts(stellata), walked.counts),
  };
}

function printableRows(rows: readonly ResidencyRow[]): Array<Record<string, string>> {
  return rows.map((row) => ({
    resource: row.label,
    size: formatBytes(row.bytes),
    copies: String(row.count ?? 1),
    basis: row.basis,
    detail: row.detail,
  }));
}

export function printMemoryInventory(inventory: MemoryInventory): void {
  const { gpu, heap, crossCheck: cross } = inventory;
  console.log(
    `GPU residency (scene walk): ${formatBytes(gpu.totalBytes)} over `
    + `${cross.walked.geometries} geometries and ${cross.walked.textures} textures, `
    + `folded into ${gpu.rows.length} rows`,
  );
  console.table(printableRows(gpu.rows));
  if (gpu.unknownRows > 0) {
    console.warn(`${gpu.unknownRows} resource(s) reported no size — counted as 0, not as free.`);
  }
  console.log(
    `Off-scene (uploaded, outside the walk — render targets and pass scenes): `
    + `${cross.offScene.textures} texture(s), ${cross.offScene.geometries} geometr(ies). `
    + `Walked but NOT uploaded (parented, never drawn — the walk charges bytes the GPU `
    + `does not hold): ${cross.unuploaded.textures} texture(s), `
    + `${cross.unuploaded.geometries} geometr(ies). `
    + `renderer.info: ${cross.renderer.textures} textures / ${cross.renderer.geometries} `
    + `geometries; walk: ${cross.walked.textures} / ${cross.walked.geometries}.`,
  );
  console.log(`JS heap, known typed arrays: ${formatBytes(heap.totalBytes)}`);
  console.table(printableRows(heap.rows));
  if (heap.unpricedFields.length > 0) {
    console.log(
      `Not priced (not typed arrays, so they hold heap with no row): `
      + `${heap.unpricedFields.join(', ')}.`,
    );
  }
  if (heap.reading) {
    console.log(
      `performance.memory: used ${formatBytes(heap.reading.usedBytes)} / `
      + `total ${formatBytes(heap.reading.totalBytes)} / limit ${formatBytes(heap.reading.limitBytes)}`,
    );
  } else {
    console.log('performance.memory: unavailable (Chrome-only) — take a heap snapshot instead.');
  }
}
