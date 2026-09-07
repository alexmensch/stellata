// Data-texture filter roster: the pair a TSL texture node bakes into its
// WGSL. Behaviour and the scan's one limit are in README.md § TSL stand-in
// filters.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isProductionTs, walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');

const GUIDANCE =
  'constructs a DataTexture / Data3DTexture without setting both minFilter '
  + 'and magFilter. The constructor default is nearest/nearest, which a TSL '
  + 'texture node bakes as an unfiltered textureLoad — so the pair is a '
  + 'decision every site owes explicitly, matching whatever texture the '
  + 'object stands in for — '
  + "src/client/webgpu/solar-system/README.md § A stand-in's filters. "
  + 'Both writes must be literal and in this file: a named target reported '
  + 'here is one whose pair is set nowhere or through a helper, and '
  + '<unassigned> is a construction no assignment can reach — give it a '
  + 'local. A shared helper is deliberately not enough: '
  + 'README.md § TSL stand-in filters.';

const SITE = /(?:(?:const|let|var)\s+(\w+)|(this\.\w+))?\s*=?\s*new\s+(?:THREE\.)?Data(?:3D)?Texture\s*\(/g;

const setsFilter = (src: string, target: string, which: string) =>
  new RegExp(`${target.replace('.', '\\.')}\\.${which}\\s*=`).test(src);

/** The construction targets in `src` whose filter pair is left on the
 *  nearest/nearest default. An unnamed target reports as `<unassigned>` —
 *  nothing can set its filters, so it is an offender by construction. */
export function unfilteredStandIns(src: string): string[] {
  const offenders: string[] = [];
  for (const [, local, field] of src.matchAll(SITE)) {
    const target = local ?? field;
    if (target === undefined) {
      offenders.push('<unassigned>');
    } else if (!setsFilter(src, target, 'minFilter')
      || !setsFilter(src, target, 'magFilter')) {
      offenders.push(target);
    }
  }
  return offenders;
}


describe('TSL stand-in filter roster', () => {
  it('every data-texture construction states its filter pair', () => {
    const offenders = [...walkFiles(join(ROOT, 'src'), { include: isProductionTs })]
      .flatMap((p) => unfilteredStandIns(readFileSync(p, 'utf8'))
        .map((t) => `${relative(ROOT, p)} (${t}) ${GUIDANCE}`));
    expect(offenders).toEqual([]);
  });
});

describe('the detector itself', () => {
  it('catches a construction left on the default pair', () => {
    expect(unfilteredStandIns('const t = new THREE.DataTexture(px, 1, 1);'))
      .toEqual(['t']);
    expect(unfilteredStandIns('this.brick = new Data3DTexture(d, 2, 2, 2);'))
      .toEqual(['this.brick']);
  });

  it('catches a construction with only one of the pair', () => {
    expect(unfilteredStandIns(
      'const t = new DataTexture(px, 1, 1);\nt.minFilter = LinearFilter;',
    )).toEqual(['t']);
  });

  it('catches a construction no assignment can reach', () => {
    expect(unfilteredStandIns('return new THREE.DataTexture(px, 1, 1);'))
      .toEqual(['<unassigned>']);
  });

  it('accepts either filter value, and both spellings of the class', () => {
    expect(unfilteredStandIns(
      'this.av = new DataTexture(px, 1, 1);\n'
      + 'this.av.minFilter = NearestFilter;\nthis.av.magFilter = NearestFilter;',
    )).toEqual([]);
    expect(unfilteredStandIns(
      'const tex = new THREE.Data3DTexture(d, 2, 2, 2);\n'
      + 'tex.minFilter = THREE.LinearFilter;\ntex.magFilter = THREE.LinearFilter;',
    )).toEqual([]);
  });

  it('leaves a texture class with filterable defaults alone', () => {
    expect(unfilteredStandIns('const t = new THREE.CanvasTexture(c);')).toEqual([]);
    expect(unfilteredStandIns('rt.depthTexture = new DepthTexture(w, h);')).toEqual([]);
  });
});
