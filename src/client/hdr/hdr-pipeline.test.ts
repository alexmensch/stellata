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
 * The target is MRT (README.md § Three attachments), built on
 * `WebGLMultipleRenderTargets` — which three deprecates at r162 in favour
 * of `new WebGLRenderTarget(w, h, { count: 2 })` and removes thereafter.
 *
 * Migrating is not a rename: `rt.texture` becomes `rt.textures`, and the
 * statistic gate's per-draw `gl.drawBuffers` calls run behind three's
 * per-framebuffer `WebGLState.drawBuffers` cache, which the seam depends on
 * never re-issuing `[0, 1]` after `bind()` shuts the gate. Re-verify that
 * against the new version rather than assuming it survives.
 */
describe('the MRT target three supplies', () => {
  it('still exists — removing it is the migration, not a version bump', () => {
    expect(THREE.WebGLMultipleRenderTargets).toBeTypeOf('function');
  });

  it('is not yet deprecated at the version this repo pins', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const minor = Number(pkg.dependencies.three.replace(/^\D*\d+\./, '').split('.')[0]);
    expect(minor).toBeLessThan(162);
  });
});
