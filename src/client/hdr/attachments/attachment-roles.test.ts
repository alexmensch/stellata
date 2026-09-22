import { readTslSource } from '../../webgpu/tsl/tsl-source-fixture';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readTslSource(new URL(name, import.meta.url));

// See README.md § The roles.
describe('the attachment roles, read off each graph', () => {
  const VOLUMETRIC = [
    { label: 'Milky Way band', src: '../../webgpu/milkyway/milkyway-band-tsl.ts' },
    { label: 'Local Group glow', src: '../../webgpu/local-group/local-group-emission-tsl.ts' },
  ];

  for (const { label, src: path } of VOLUMETRIC) {
    it(`the ${label} writes the extended-source struct into attachments 1 and 2`, () => {
      const src = read(path);
      expect(src).toContain('emitExtendedSourceTsl(');
      for (const member of ['statistic', 'diffuse']) {
        expect(src).toMatch(
          new RegExp(`${member}: select\\([^;]*lit\\.${member}, nothing\\.${member}\\)`),
        );
      }
    });
  }

  it('an extended source leaves attachment 0 black on-target', () => {
    const src = read('../../webgpu/extended-emitter-tsl.ts');
    expect(src).toContain('const colour = vec4(0.0).toVar();');
    expect(src).toMatch(/If\(i\.hdrTarget\.lessThanEqual\(0\.5\), \(\) => \{\s*colour\.assign\(/);
    expect(src).toMatch(/const diffuse = vec4\(\s*gainedColumnTsl\([^;]*i\.omegaSummationArcsec2\)/);
  });

  it('cloud absorption dims attachments 0 and 2 and leaves the statistic', () => {
    const src = read('../../webgpu/molecular-clouds/cloud-absorption-tsl.ts');
    expect(src).toContain('return { colour: texel, statistic: vec4(0.0), diffuse: texel };');
  });
});
