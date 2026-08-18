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

// Orientation has to arrive from the decode. An HTMLImageElement upload puts
// it back on UNPACK_FLIP_Y_WEBGL, whose tracked value a write elsewhere in the
// app can desync from GL (../../loaders/README.md) — and a map that arrives
// unflipped shades the mirrored hemisphere while changing nothing else.
describe('planet maps decode with an explicit orientation', () => {
  const src = read('./planet-mesh-layer.ts');

  it('bakes the flip into the bitmap, and never loads through TextureLoader', () => {
    expect(TEXTURE_DECODE_OPTIONS.imageOrientation).toBe('flipY');
    expect(src).toContain('tex.flipY = false');
    expect(src).not.toContain('new THREE.TextureLoader');
  });

  // Each horizon map's fourth azimuth rides the alpha channel
  // (surface-relief/README.md), so a premultiplying decode scales the other
  // three by it. Both are spelled out because setOptions replaces the loader's
  // own defaults rather than merging into them.
  it('never premultiplies and never converts colour space', () => {
    expect(TEXTURE_DECODE_OPTIONS.premultiplyAlpha).toBe('none');
    expect(TEXTURE_DECODE_OPTIONS.colorSpaceConversion).toBe('none');
  });

  // The loader assigns its own forced options over the object it is given.
  it('hands the loader a copy of the options, not the exported constant', () => {
    expect(src).toContain('setOptions({ ...TEXTURE_DECODE_OPTIONS })');
  });
});

// The normal map is the ONE map that may narrow below RGBA8: blue is a
// constant by construction and alpha is unused, and the shader samples .rg
// and reconstructs z. Widening this to the whole relief branch would take
// the horizon planes down with it — half of each one's four azimuths live
// in blue and alpha — and the failure reads as wrong terrain rather than a
// missing texture, which is why it gets a pin rather than a smoke.
describe('only the normal map uploads as RG8', () => {
  const src = read('./planet-mesh-layer.ts');
  const fetches = src.slice(src.indexOf('if (reliefSpanOf(planet))'));
  const normalFetch = fetches.slice(0, fetches.indexOf('for (const suffix of'));
  const horizonFetch = fetches.slice(
    fetches.indexOf('for (const suffix of'),
    fetches.indexOf('if (planet.rings)'),
  );

  it('narrows the normal map and nothing else', () => {
    expect(normalFetch).toContain('RELIEF_SUFFIX');
    expect(normalFetch).toContain('THREE.RGFormat');
    expect(horizonFetch).toContain('HORIZON_SUFFIXES');
    expect(horizonFetch).not.toContain('RGFormat');
  });

  it('is the only format override in the layer', () => {
    expect(src.match(/RGFormat/g)).toHaveLength(1);
    // Colour maps and ring strips carry signal in all four channels.
    expect(src).not.toContain('RedFormat');
  });
});
