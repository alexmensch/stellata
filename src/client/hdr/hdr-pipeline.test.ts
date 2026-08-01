import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { HDR_DEFAULT_ENABLED } from './hdr-pipeline';

// HdrPipeline itself needs a live WebGL2 context, so the class is
// manual-smoke only. The ship gate is pinned here so enabling the seam is
// a deliberate two-line change rather than a stray default.
describe('HDR_DEFAULT_ENABLED', () => {
  it('is on — stars, the Milky Way and the planet layers all emit luminance', () => {
    expect(HDR_DEFAULT_ENABLED).toBe(true);
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
