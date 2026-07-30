import { describe, it, expect } from 'vitest';
import { HDR_DEFAULT_ENABLED } from './hdr-pipeline';

// HdrPipeline itself needs a live WebGL2 context, so the class is
// manual-smoke only. The ship gate is pinned here so enabling the seam is
// a deliberate two-line change rather than a stray default.
describe('HDR_DEFAULT_ENABLED', () => {
  it('is on — stars, the Milky Way and the planet layers all emit luminance', () => {
    expect(HDR_DEFAULT_ENABLED).toBe(true);
  });
});
