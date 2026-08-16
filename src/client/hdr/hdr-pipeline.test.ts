import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { HDR_ATTACHMENT_COUNT, createHdrTarget } from './hdr-pipeline';

// HdrPipeline itself needs a live WebGL2 context, so the class is
// manual-smoke only.
//
// The seam has no switch left to pin. A build without the target is not a
// calibrated build — the diffuse emitters lose attachment 2 and the
// convolution with it, so the band and the Local Group read several magnitudes
// faint — so the only thing that may turn it off is a context that cannot
// support it. What this file pins instead is that nothing can reach it.
describe('the seam has no off switch', () => {
  it('exposes no way to park the target from outside the class', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./hdr-pipeline.ts', import.meta.url)),
      'utf8',
    );
    expect(src).not.toMatch(/setEnabled|HDR_DEFAULT_ENABLED/);
    // `supported` is the hardware verdict and `setChartMode` the bypass; both
    // are legitimate. A third input to wantsTarget() would be a new switch.
    expect(src).toContain('return this.supported && !this.chart;');
  });

  it('is not reachable from the dev console either', () => {
    const shell = readFileSync(
      fileURLToPath(new URL('../stellata.ts', import.meta.url)),
      'utf8',
    );
    expect(shell).not.toMatch(/setHdrEnabled|hdr\.setEnabled/);
  });
});

// Per-attachment format and filters are three's to keep, and a resize is where
// it could drop them: attachment 1 falling back to RGBA would silently double
// the statistic's memory and change what the reduction reads. The gate's other
// three-side dependency, the `WebGLState.drawBuffers` cache, needs a context —
// attachments/README.md § The cache the gate rides.
describe('the MRT target the seam builds', () => {
  it('gives each attachment the format and filters its consumer needs', () => {
    const rt = createHdrTarget(8, 8);
    expect(rt.textures).toHaveLength(HDR_ATTACHMENT_COUNT);
    expect(rt.textures[0].format).toBe(THREE.RGBAFormat);
    expect(rt.textures[1].format).toBe(THREE.RGFormat);
    expect(rt.textures[2].minFilter).toBe(THREE.LinearFilter);
    expect(rt.textures[2].magFilter).toBe(THREE.LinearFilter);
  });

  it('keeps that per-attachment state across a resize', () => {
    const rt = createHdrTarget(8, 8);
    rt.setSize(16, 16);
    expect(rt.textures[1].format).toBe(THREE.RGFormat);
    expect(rt.textures[2].minFilter).toBe(THREE.LinearFilter);
    expect((rt.textures[1].image as { width: number }).width).toBe(16);
  });

  // The MRT-vs-single-target frame-cost lever rebuilds the target with
  // attachment 0 alone; the default stays the full three.
  it('builds a single-attachment target when the lever asks for one', () => {
    const rt = createHdrTarget(8, 8, 1);
    expect(rt.textures).toHaveLength(1);
    expect(rt.textures[0].format).toBe(THREE.RGBAFormat);
  });

  // The three inputs three's getInternalDepthFormat reads to land on
  // DEPTH_COMPONENT24 rather than a 16-bit renderbuffer, which would coarsen
  // every close-range z-test by 256x (../local-depth/README.md § Precision).
  it('carries the 24-bit depth attachment the local-depth bound assumes', () => {
    const rt = createHdrTarget(8, 8);
    expect(rt.depthBuffer).toBe(true);
    expect(rt.stencilBuffer).toBe(false);
    expect(rt.depthTexture).toBe(null);
  });
});
