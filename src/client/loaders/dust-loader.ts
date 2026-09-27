// Progressive loader for the 3D dust-extinction voxel grid: zero-fill
// Data3DTexture, fetch chunks priority-ordered, upload each arrival
// through the voxel uploader. See src/client/loaders/README.md.

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

/** see README.md#dust-voxel-upload */
export async function loadDustManifest(baseUrl: string): Promise<DustManifest | null> {
  let raw: unknown;
  try {
    const res = await fetch(`${baseUrl}manifest.json`);
    if (!res.ok) return null;
    raw = await res.json();
  } catch {
    return null;
  }
  const err = dustManifestError(raw);
  if (err !== null) {
    console.warn(`dust manifest.json ${err} — rebuild with \`pnpm run build:dust-sync\``);
    return null;
  }
  return raw as DustManifest;
}

/** Why `raw` cannot build a DustField, or null when it can. */
export function dustManifestError(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'is not an object';
  const m = raw as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const positiveInt = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
  if (!positiveInt(m.gridSize) || !positiveInt(m.chunkSize)) return 'has no positive gridSize / chunkSize';
  if ((m.gridSize as number) % (m.chunkSize as number) !== 0) return 'has a chunkSize that does not divide gridSize';
  if (!Array.isArray(m.boundsPc) || m.boundsPc.length !== 2 || !m.boundsPc.every(finite)) {
    return 'has no [min, max] boundsPc';
  }
  if (!finite(m.densityMin) || !finite(m.densityMax) || !(m.densityMin > 0 && m.densityMax > m.densityMin)) {
    return 'needs 0 < densityMin < densityMax';
  }
  if (!finite(m.avPerDensityPerPc)) return 'has no avPerDensityPerPc';
  if (!finite(m.totalChunks) || typeof m.synthetic !== 'boolean') return 'has no totalChunks / synthetic';
  if (!Array.isArray(m.chunks)) return 'has no chunks list';
  const chunkOk = (c: unknown) => {
    if (typeof c !== 'object' || c === null) return false;
    const k = c as Record<string, unknown>;
    return Number.isInteger(k.ix) && Number.isInteger(k.iy) && Number.isInteger(k.iz)
      && typeof k.file === 'string' && finite(k.bytes)
      && Array.isArray(k.centerPc) && k.centerPc.length === 3 && k.centerPc.every(finite);
  };
  const bad = m.chunks.findIndex((c) => !chunkOk(c));
  return bad === -1 ? null : `has a malformed chunk at index ${bad}`;
}
