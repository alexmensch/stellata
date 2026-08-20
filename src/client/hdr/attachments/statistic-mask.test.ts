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
    { label: 'star quad', frag: '../../star-pipeline/star.frag.glsl' },
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

  it('claims no coverage on the TSL star path either', () => {
    // The WebGPU port's one statistic writer so far. TSL is TypeScript, so
    // the same contract is read off the starMrtStruct call: flux gated by
    // the park mask, mask 0, alpha 1 (webgpu/hdr/README.md § The gate
    // becomes the output struct).
    const src = read('../../webgpu/star/star-emission-tsl.ts');
    expect(src).toContain(
      'statisticTexelTsl(\n      v.vFluxPeakL.mul(glow).mul(gates.statisticWrites), 0.0, 1.0)',
    );
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
