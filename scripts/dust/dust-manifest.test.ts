// Pins the data/dust/manifest.json encode contract (fixed DENSITY_MAX
// ceiling) and the per-cloud Zucker column-check provenance. The LFS
// chunk-integrity test self-skips on pointer stubs (real in tier-a-corpus).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DUST_DIR = resolve(ROOT, 'data', 'dust');
const MANIFEST = resolve(DUST_DIR, 'manifest.json');

interface Manifest {
  version: number;
  format: string;
  synthetic: boolean;
  gridSize: number;
  densityMin: number;
  densityMax: number;
  avPerDensityPerPc: number;
  chunks: Array<{ file: string; bytes: number; sha256: string }>;
  zucker: {
    gridMaxZgr: number;
    clouds: Array<{
      cloud: string;
      avColumnTargetLeike: number;
      avPeakColumnEdenhofer: number;
      ratio: number;
    }>;
  };
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as Manifest;

describe('data/dust/manifest.json encode contract', () => {
  it('pins the fixed encode window', () => {
    expect(manifest.version).toBe(2);
    expect(manifest.format).toBe('u8-log-window');
    expect(manifest.synthetic).toBe(false);
    expect(manifest.densityMin).toBe(1e-7);
    expect(manifest.densityMax).toBe(0.2);
    expect(manifest.avPerDensityPerPc).toBe(2.742);
    expect(manifest.chunks).toHaveLength(64);
  });

  it('ceiling covers the raw grid maximum with headroom', () => {
    expect(manifest.zucker.gridMaxZgr).toBe(0.1346);
    expect(manifest.zucker.gridMaxZgr * 1.2).toBeLessThanOrEqual(manifest.densityMax);
  });

  it('pins the per-cloud peak-column check against the Zucker targets', () => {
    const byCloud = Object.fromEntries(
      manifest.zucker.clouds.map((c) => [c.cloud, c]),
    );
    expect(Object.keys(byCloud)).toHaveLength(11);
    // Ophiuchus reaches its Leike-resolution target outright; the others
    // sit at 0.19-0.9× — consistent with 1 pc → 4.9 pc beam dilution
    // (docs/molecular-clouds.md § 4). A collapse below these levels means
    // an encode or resample regression.
    expect(byCloud['Ophiuchus'].ratio).toBe(1.03);
    expect(byCloud['Taurus'].ratio).toBe(0.5);
    expect(byCloud['Taurus'].avPeakColumnEdenhofer).toBe(1.625);
    expect(byCloud['Taurus'].avColumnTargetLeike).toBe(3.248);
    for (const c of manifest.zucker.clouds) {
      expect(c.ratio, c.cloud).toBeGreaterThan(0.03);
    }
  });
});

const firstChunk = resolve(DUST_DIR, 'chunk_0_0_0.bin');
const chunkIsReal =
  existsSync(firstChunk) && statSync(firstChunk).size === 128 ** 3;

describe.skipIf(!chunkIsReal)('data/dust chunk integrity (LFS)', () => {
  it('committed chunk bytes match the manifest sha256', () => {
    const entry = manifest.chunks.find((c) => c.file === 'chunk_0_0_0.bin')!;
    const bytes = readFileSync(firstChunk);
    expect(bytes.length).toBe(entry.bytes);
    expect(createHash('sha256').update(bytes).digest('hex').slice(0, 16)).toBe(
      entry.sha256,
    );
  });
});
