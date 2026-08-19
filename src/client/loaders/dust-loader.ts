// Progressive loader for the 3D dust-extinction voxel grid: zero-fill
// Data3DTexture, fetch chunks priority-ordered, upload each arrival
// through the per-backend voxel uploader. See src/client/loaders/README.md.

import type * as THREE from 'three';
import type { StellataRenderer } from '../webgpu/seam';
import {
  createVoxelChunkUploader,
  createVoxelTexture,
  type VoxelChunkUploader,
} from './dust-voxel-upload';

export interface DustManifest {
  version: number;
  format: string;
  synthetic: boolean;
  gridSize: number;
  chunkSize: number;
  chunksPerAxis: number;
  totalChunks: number;
  boundsPc: [number, number];
  voxelSizePc: number;
  densityMin: number;
  densityMax: number;
  avPerDensityPerPc: number;
  chunks: DustChunkMeta[];
  particles?: { file: string; count: number };
}

/** Pre-computed dust particle cloud — importance-sampled positions +
 *  densities to render as additive billboards. Replaces the abandoned
 *  fullscreen-fog raymarch (which had unfixable banding/jitter at far
 *  zoom). Format: 16-byte header ('PART' magic + version + count) then
 *  N × 16 bytes of (x, y, z, density) float32 records. */
export interface DustParticleData {
  count: number;
  /** Float32Array of length count × 3, xyz triples in absolute ICRS pc. */
  positions: Float32Array;
  /** Float32Array of length count, raw density values from the source grid. */
  densities: Float32Array;
}

// Convention: loadDustParticles is single-shot and returns null on any
// failure (bad magic, bad version, size mismatch, fetch error, exception).
// The lazy-fetch path (`Stellata.setParticleStrength`) skips attach on
// null, leaving the scene without dust particles but otherwise
// functional. Distinct from
// fetchAndUpload below, which is one of N parallel chunk fetches and
// throws on size mismatch so a single bad chunk doesn't stop the rest —
// startLoading() catches the throw per-chunk and continues. Both paths
// end at "log and skip" but the mechanisms reflect the surrounding
// concurrency.
export async function loadDustParticles(
  baseUrl: string,
  meta: { file: string; count: number },
): Promise<DustParticleData | null> {
  try {
    const res = await fetch(`${baseUrl}${meta.file}`);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const view = new DataView(ab);
    const magic = String.fromCharCode(
      view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3),
    );
    if (magic !== 'PART') {
      console.warn(`dust particles: bad magic '${magic}'`);
      return null;
    }
    const version = view.getUint32(4, true);
    if (version !== 1) {
      console.warn(`dust particles: unsupported version ${version}`);
      return null;
    }
    const count = view.getUint32(8, true);
    if (count !== meta.count) {
      console.warn(`dust particles: count mismatch (manifest ${meta.count}, file ${count})`);
    }
    // Validate file size against the file-derived count rather than trusting
    // the manifest: a truncated/corrupt particles.bin would otherwise either
    // throw inside the Float32Array constructor (non-multiple-of-4 byteLength)
    // or hand us an out-of-bounds view that reads garbage past the buffer.
    const expectedBytes = 16 + count * 16;
    if (ab.byteLength !== expectedBytes) {
      console.warn(
        `dust particles: bad file size (got ${ab.byteLength}, expected ${expectedBytes} for count=${count})`,
      );
      return null;
    }
    // Records start at byte 16. 4 floats per record (xyz + density),
    // interleaved. Split into separate xyz and density typed arrays so
    // the GPU instance attributes can bind directly.
    const positions = new Float32Array(count * 3);
    const densities = new Float32Array(count);
    const records = new Float32Array(ab, 16, count * 4);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = records[i * 4 + 0];
      positions[i * 3 + 1] = records[i * 4 + 1];
      positions[i * 3 + 2] = records[i * 4 + 2];
      densities[i] = records[i * 4 + 3];
    }
    return { count, positions, densities };
  } catch (err) {
    console.warn('dust particles: load failed', err);
    return null;
  }
}

export interface DustChunkMeta {
  ix: number;
  iy: number;
  iz: number;
  file: string;
  bytes: number;
  sha256: string;
  centerPc: [number, number, number];
}

/** Stream order, and the order the readback verifier samples in — the
 *  chunks it reaches first are the ones certain to have landed. */
export function closestChunksFirst(chunks: DustChunkMeta[]): DustChunkMeta[] {
  const distSq = (c: DustChunkMeta) =>
    c.centerPc[0] ** 2 + c.centerPc[1] ** 2 + c.centerPc[2] ** 2;
  return [...chunks].sort((a, b) => distSq(a) - distSq(b));
}

export interface DustFieldParams {
  boundsHalfPc: number;      // 1250
  densityMin: number;        // 1e-7
  densityMax: number;        // autotuned from data (~1e-3)
  avPerDensityPerPc: number; // 2.742
  // Shader decode: density = densityMin * pow(ratio, sample).
  // Precomputed: ratio = densityMax / densityMin, logRatio = ln(ratio).
  logRatio: number;
}

export interface DustLoadProgress {
  loaded: number;
  total: number;
  synthetic: boolean;
}

const MAX_CONCURRENT_FETCHES = 6;

export class DustField {
  readonly texture: THREE.Data3DTexture;
  readonly params: DustFieldParams;
  readonly manifest: DustManifest;

  // Track chunk-load completion so consumers can surface a subtle progress
  // indicator if desired. A listener is called after every chunk-upload.
  private listeners: Array<(p: DustLoadProgress) => void> = [];
  private loadedCount = 0;

  private readonly uploader: VoxelChunkUploader;
  readonly baseUrl: string;

  constructor(renderer: StellataRenderer, baseUrl: string, manifest: DustManifest) {
    this.baseUrl = baseUrl;
    this.manifest = manifest;

    const n = manifest.gridSize;
    const zeroFill = new Uint8Array(n * n * n); // no extinction until chunks land
    const tex = createVoxelTexture(n, zeroFill);
    this.uploader = createVoxelChunkUploader(renderer, tex, manifest.chunkSize);
    this.texture = tex;
    this.params = {
      boundsHalfPc: Math.abs(manifest.boundsPc[1]),
      densityMin: manifest.densityMin,
      densityMax: manifest.densityMax,
      avPerDensityPerPc: manifest.avPerDensityPerPc,
      logRatio: Math.log(manifest.densityMax / manifest.densityMin),
    };
  }

  onProgress(h: (p: DustLoadProgress) => void) {
    this.listeners.push(h);
  }

  // Release the ~128 MiB Data3DTexture and drop progress listeners.
  // Idempotent — three.js .dispose() on an already-disposed texture is a
  // no-op.
  dispose() {
    this.texture.dispose();
    this.uploader.dispose();
    this.listeners.length = 0;
  }

  /** Kick off background downloads. Resolves when every chunk has been
   *  fetched + uploaded, but callers typically fire-and-forget — the
   *  texture is usable the whole time; it just gets denser as chunks land. */
  async startLoading(): Promise<void> {
    // Priority: closest-to-origin first. When the user later flies far from
    // Sol the camera is typically revisiting the dense inner volume we've
    // already loaded; the far-corner chunks only matter for distant-fog
    // rendering which is a secondary concern anyway.
    const ordered = closestChunksFirst(this.manifest.chunks);

    // Simple semaphore — cap parallel fetches so mobile Safari doesn't
    // hang with 64 inflight requests. Workers static assets are served
    // HTTP/2 so a handful of parallel streams is plenty.
    let i = 0;
    const worker = async () => {
      while (i < ordered.length) {
        const idx = i++;
        const chunk = ordered[idx];
        try {
          await this.fetchAndUpload(chunk);
          this.loadedCount++;
          for (const h of this.listeners) {
            h({
              loaded: this.loadedCount,
              total: this.manifest.totalChunks,
              synthetic: this.manifest.synthetic,
            });
          }
        } catch (err) {
          // One bad chunk shouldn't prevent the rest from loading — the
          // unaffected regions still render correctly. Log and continue.
          console.warn(`dust chunk ${chunk.file} failed:`, err);
        }
      }
    };
    const workers = Array.from({ length: MAX_CONCURRENT_FETCHES }, worker);
    await Promise.all(workers);
  }

  private async fetchAndUpload(chunk: DustChunkMeta): Promise<void> {
    const res = await fetch(`${this.baseUrl}${chunk.file}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength !== chunk.bytes) {
      throw new Error(`size mismatch: ${buf.byteLength} vs ${chunk.bytes}`);
    }
    this.uploader.upload(chunk.ix, chunk.iy, chunk.iz, new Uint8Array(buf));
  }
}

/** Fetch manifest.json. Returns null (without throwing) if the manifest
 *  is missing — dust is an optional feature and its absence should leave
 *  the existing renderer untouched. */
export async function loadDustManifest(baseUrl: string): Promise<DustManifest | null> {
  try {
    const res = await fetch(`${baseUrl}manifest.json`);
    if (!res.ok) return null;
    return (await res.json()) as DustManifest;
  } catch {
    return null;
  }
}
