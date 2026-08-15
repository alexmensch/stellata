import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

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

/**
 * Two properties of the MRT target (README.md § Three attachments) belong to
 * three rather than to the seam, and a version bump can take either away:
 *
 * - Attachments past 0 carry their own format and filters, and a resize must
 *   not reset them — a resize that dropped attachment 1 back to RGBA would
 *   silently double the statistic's memory and change what the reduction reads.
 * - The per-draw `gl.drawBuffers` gate is issued straight to the context, so it
 *   holds only while three's per-framebuffer `WebGLState.drawBuffers` cache
 *   leaves it alone. That cache re-issues on a change of attachment count or of
 *   slot 0, neither of which the gate touches — verified by reading three's
 *   source, since `WebGLState` is not reachable from a test without a context.
 *
 * Re-verify both on a version bump rather than assuming they survive.
 */
describe('the MRT target three supplies', () => {
  const target = (): THREE.WebGLRenderTarget =>
    new THREE.WebGLRenderTarget(8, 8, {
      count: 3,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
    });

  it('gives every attachment independent texture state', () => {
    const rt = target();
    expect(rt.textures).toHaveLength(3);
    rt.textures[1].format = THREE.RGFormat;
    expect(rt.textures[0].format).toBe(THREE.RGBAFormat);
    expect(rt.textures[2].format).toBe(THREE.RGBAFormat);
  });

  it('keeps per-attachment format and filters across a resize', () => {
    const rt = target();
    rt.textures[1].format = THREE.RGFormat;
    rt.textures[2].minFilter = THREE.LinearFilter;
    rt.setSize(16, 16);
    expect(rt.textures[1].format).toBe(THREE.RGFormat);
    expect(rt.textures[2].minFilter).toBe(THREE.LinearFilter);
    expect((rt.textures[1].image as { width: number }).width).toBe(16);
  });
});
