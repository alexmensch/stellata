import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { glslCallArgs } from '../../util/glsl-call-args';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

/** The mask argument of a shader's `stellataStatisticTexel` write. */
function maskArg(frag: string): string {
  return glslCallArgs(read(frag), 'stellataStatisticTexel')[1];
}

// The G channel used to carry peak-correct luminance and now carries a 0/1
// lit-surface mask, which the reduction divides the masked mean by. Passing a
// luminance there is the porting error the whole regime test used to turn on:
// it compiles, it renders, and the exposure silently reads a body's texture
// instead of its coverage. Nothing else pins which emitters may claim area.
describe('the statistic attachment mask', () => {
  const KERNELS = [
    {
      label: 'planet reflected glare',
      frag: '../../solar-system/planets/glare/planet.frag.glsl',
    },
    { label: 'volumetric emitter', frag: '../emission/extended-emitter.glsl' },
  ];

  for (const { label, frag } of KERNELS) {
    it(`claims no coverage for the ${label}`, () => {
      expect(maskArg(frag)).toBe('0.0');
    });
  }

  it('claims the resolved disc core alone for the star quad', () => {
    // The claim is a PROPERTY, not a whitelist: an emitter claims coverage
    // exactly where it emits surface brightness over its own physical
    // footprint rather than a PSF peak over an exaggerated kernel. For this
    // pipeline that is the disc pass restricted to the core — the glow pass
    // passes a literal zero at every framing, and a resolved photosphere is
    // the one resolved surface that used to be excluded by the old
    // enumerated contract.
    const src = read('../../star-pipeline/star.frag.glsl');
    expect(glslCallArgs(src, 'stellataStatisticTexel')[1]).toBe('coreMask');
    expect(src).toContain('float core = step(uCoreThreshold, glow);');
    expect(src).toContain('starEmission(glow, core);');
    expect(src).toContain('starEmission(glow, 0.0);');
  });

  // TSL is TypeScript, so the ported writers read off the same argument
  // walker rather than a second mechanism. Their helper takes the park mask
  // FIRST and scales the whole texel by it — masking the flux alone would
  // leave an alpha-composited emitter still compositing `dst · (1 − alpha)`
  // over the attachment the WebGL gate would have shut
  // (webgpu/hdr/README.md § The gate becomes the output struct).
  const TSL_WRITERS = [
    {
      label: 'star quad',
      src: '../../webgpu/star/star-emission-tsl.ts',
      mask: 'coreMask(glow)',
      alpha: '1.0',
    },
    {
      label: 'planet reflected glare',
      src: '../../webgpu/solar-system/planet-glare-tsl.ts',
      mask: '0.0',
      alpha: '1.0',
    },
    {
      label: 'planet mesh',
      src: '../../webgpu/solar-system/planet-mesh-tsl.ts',
      mask: 'lit',
      alpha: 'p.uFade',
    },
    {
      label: 'ring annulus',
      src: '../../webgpu/solar-system/planet-rings-tsl.ts',
      mask: 'step(0.5, lit)',
      alpha: 'alpha',
    },
    {
      label: 'atmosphere shell',
      src: '../../webgpu/solar-system/planet-atmosphere-tsl.ts',
      mask: 'a.mul(litFrac)',
      alpha: 'a',
    },
  ];

  for (const { label, src, mask, alpha } of TSL_WRITERS) {
    it(`carries the ${label}'s mask and park gate on the TSL path`, () => {
      const args = glslCallArgs(read(src), 'maskedStatisticTexelTsl');
      expect(args[0]).toBe('gates.statisticWrites');
      expect(args[2]).toBe(mask);
      expect(args[3]).toBe(alpha);
    });
  }

  it('routes the star quad\'s TSL mask per pass, disc core against glow zero', () => {
    // The two colour passes share one fragment builder, so the claim is the
    // argument each hands it — the GLSL twin's two `starEmission` call sites
    // expressed as a node. Same core threshold the depth-only mask stamps.
    expect(read('../../webgpu/star/star-disc-tsl.ts'))
      .toContain('step(deps.u.uCoreThreshold, glow)');
    expect(read('../../webgpu/star/star-glow-tsl.ts'))
      .toContain('const coreMask = () => float(0.0);');
  });

  it('writes no statistic at all from the TSL probe glyph', () => {
    // Chrome, so the slot takes the blend's identity element rather than a
    // masked texel — the WebGL gate's `[0, NONE, NONE]` in node terms.
    const src = read('../../webgpu/solar-system/probe-tsl.ts');
    expect(src).not.toContain('maskedStatisticTexelTsl');
    expect(src).toContain('statistic: vec4(0.0)');
  });

  it('claims the lit hemisphere alone for the planet mesh', () => {
    // The night side is the one dark region big enough to move the masked
    // mean: counted as coverage it would halve D at full phase and gut it on
    // a crescent, under-cutting the exposure the surface is pinned at.
    const src = read('../../solar-system/planets/planet-mesh.frag.glsl');
    expect(glslCallArgs(src, 'stellataStatisticTexel')[1]).toBe('lit');
    expect(src).toContain('float lit = step(0.0, sunCos) * step(0.5, shadow);');
  });

  it('claims the sunlit annulus alone for the ring strip', () => {
    // The band in the planet's shadow is the annulus's night side, and the
    // annulus runs several times the globe's own disc area — counted as
    // coverage at SHADOW_FLOOR it is the largest dark-coverage term the model
    // has. Alpha-composited, so the one blend equation scales mask and flux by
    // the same strip opacity and the ratio the pin reads stays alpha-invariant.
    const src = read('../../solar-system/planets/rings/planet-rings.frag.glsl');
    expect(glslCallArgs(src, 'stellataStatisticTexel')[1]).toBe('step(0.5, lit)');
    expect(src).toContain('float unshadowed = step(bodyRoots(frag, uSunDirLocal).y, 0.0);');
  });

  it('premultiplies the shell mask by its opacity and its sunlit share', () => {
    // The one blend whose source factor is One, so the shell's own
    // contribution has to arrive already scaled by its opacity or the limb
    // would claim area it does not cover. The night-limb chord is the dense
    // one — it occludes at full opacity while scattering nothing toward the
    // eye — so opacity alone would claim the whole limb on a crescent.
    const src = read('../../solar-system/atmosphere/planet-atmosphere.frag.glsl');
    const args = glslCallArgs(src, 'stellataStatisticTexel');
    expect(args[1]).toBe('a * litFrac');
    expect(args[2]).toBe('a');
    expect(src).toContain('float a = opacity * uFade;');
    expect(src).toContain('stellata_shadowSpan(o, dir, sunDir, s0, s1);');
  });
});
