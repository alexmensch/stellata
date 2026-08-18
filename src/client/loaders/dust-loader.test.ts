import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = readFileSync(
  fileURLToPath(new URL('./dust-loader.ts', import.meta.url)),
  'utf8',
);

// Poking the context directly leaves three's state cache claiming a flip that
// is no longer set, so the next flipY upload skips its own call and lands
// mirrored — a texture the user sees flipped, from a write in a different
// subsystem. The reset has to go through renderer.state to stay truthful.
describe('the dust chunk upload clears unpack state through three', () => {
  it('never sets a pixel-store parameter straight on the context', () => {
    expect(src).not.toContain('gl.pixelStorei');
  });

  it('clears flip, premultiply and alignment before the chunk upload', () => {
    expect(src).toContain('state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)');
    expect(src).toContain(
      'state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)',
    );
    expect(src).toContain('state.pixelStorei(gl.UNPACK_ALIGNMENT, 1)');
  });
});
