import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { glslCallArgs } from '../../util/glsl-call-args';
import { TEXTURE_DECODE_OPTIONS } from './planet-mesh-layer';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

/** The alpha of a `vec4(rgb, a)` write, or the sole argument of an occluder
 *  texel. */
const lastArgOf = (src: string, name: string) => glslCallArgs(src, name).at(-1);

// Every surface this layer draws alpha-composites in FRONT of the volumetric
// emitters, which live in attachment 2 until the resolve convolves them
// (../../hdr/summation/README.md). Depth cannot help: the emitters drew first
// and the resolve adds attachment 2 unconditionally, so a surface that leaves
// the diffuse field out of its own blend chain gets the Milky Way band added
// back on top of it — visible on a planet's night side, a shadowed ring
// section and the atmosphere limb, exactly where the surface is dim.
describe('the planet surfaces occlude the diffuse attachment', () => {
  const SURFACES = [
    { label: 'body mesh', frag: './planet-mesh.frag.glsl' },
    { label: 'ring annulus', frag: './rings/planet-rings.frag.glsl' },
    { label: 'atmosphere shell', frag: '../atmosphere/planet-atmosphere.frag.glsl' },
  ];

  for (const { label, frag } of SURFACES) {
    describe(label, () => {
      const src = read(frag);

      it('declares the diffuse attachment it has to dim', () => {
        expect(src).toMatch(/layout\(location = 2\) out vec4 outDiffuse;/);
      });

      // One blend equation runs over every attachment, so black at the
      // fragment's own alpha dims attachment 2 by exactly the opacity
      // attachment 0 was composited with. A DIFFERENT alpha would occlude the
      // band by a different amount than it occludes everything else — which
      // is the one way this can go wrong without failing to compile.
      it('dims it by the same alpha it composites attachment 0 with', () => {
        expect(src).toContain('outDiffuse = stellataOccluderTexel(');
        expect(lastArgOf(src, 'stellataOccluderTexel')).toBe(
          lastArgOf(src, 'outColor = vec4'),
        );
      });
    });
  }

  // The `location = 2` declarations above are discarded unless the draw opens
  // attachment 2, and a draw that opens it without declaring the output leaves
  // it undefined. Neither half errors on its own, so both are pinned.
  it('marks all three meshes occluding emitters, so the gate opens', () => {
    const src = read('./planet-mesh-layer.ts');
    expect(src.match(/markOccludingEmitter\(mesh\)/g)).toHaveLength(SURFACES.length);
    expect(src).not.toContain('markStatisticEmitter');
  });
});

// A map that arrives unflipped shades the mirrored hemisphere and changes
// nothing else, so neither half of this pairing survives alone: the bitmap
// carries the flip, and the texture must therefore not ask for one at upload.
// Reverting to TextureLoader puts the flip back on UNPACK_FLIP_Y_WEBGL, which
// is the step that failed in the wild.
describe('planet maps decode with an explicit orientation', () => {
  const src = read('./planet-mesh-layer.ts');

  it('bakes the flip into the bitmap and disables the upload flip', () => {
    expect(TEXTURE_DECODE_OPTIONS.imageOrientation).toBe('flipY');
    expect(src).toContain('tex.flipY = false');
    expect(src).not.toContain('new THREE.TextureLoader');
  });

  // The horizon pair's fourth and eighth azimuths ride the alpha channel
  // (surface-relief/README.md), so a premultiplying decode scales the other
  // three by a neighbouring azimuth's skyline.
  it('never premultiplies and never converts colour space', () => {
    expect(TEXTURE_DECODE_OPTIONS.premultiplyAlpha).toBe('none');
    expect(TEXTURE_DECODE_OPTIONS.colorSpaceConversion).toBe('none');
  });
});
