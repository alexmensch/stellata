// See /tests/README.md#node-import-boundary.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { walkFiles } from './walk-files';
import { importSpecifiers, isShippedSource } from './import-specifiers';
import { BROWSER_TREES, treeRoots } from './source-trees';

const ROOT = resolve(__dirname, '..');

const isNodeBuiltin = (spec: string) => spec.startsWith('node:');
// Nothing in a browser tree may import a module carrying the fixture suffix.
const isFixtureRef = (spec: string) => /-fixture$/.test(spec);

function violationsInSource(src: string): string[] {
  const out: string[] = [];
  for (const { spec, kind, typeOnly } of importSpecifiers(src)) {
    // A type-only import is erased before the bundler sees it, so it costs
    // the browser nothing and is how the fixture's row type crosses.
    if (typeOnly) continue;
    if (isNodeBuiltin(spec)) out.push(`${kind} of ${spec}`);
    else if (isFixtureRef(spec)) out.push(`${kind} of ${spec} (test fixture)`);
  }
  return out;
}

describe('node import boundary', () => {
  it('no module in a browser tree reaches node: or a fixture', () => {
    const offenders: string[] = [];
    const files = treeRoots(BROWSER_TREES).flatMap((root) => [...walkFiles(join(ROOT, root), { include: isShippedSource })]);
    for (const p of files) {
      for (const v of violationsInSource(readFileSync(p, 'utf8'))) {
        offenders.push(`${relative(ROOT, p)}: ${v}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // The boundary is only worth anything while something actually sits on the
  // far side of it; without this the suite passes by scanning nothing.
  it('the fixture it exempts is real and does read the filesystem', () => {
    const fixture = join(ROOT, 'src', 'client', 'webgpu', 'tsl', 'tsl-source-fixture.ts');
    expect(violationsInSource(readFileSync(fixture, 'utf8')).length).toBeGreaterThan(0);
  });
});

describe('the detector itself', () => {
  it('catches every form that would land a builtin in the browser bundle', () => {
    expect(violationsInSource("import { readFileSync } from 'node:fs';")).toHaveLength(1);
    expect(violationsInSource("import 'node:fs';")).toEqual(['side-effect import of node:fs']);
    expect(violationsInSource("export { x } from 'node:path';")).toHaveLength(1);
    expect(violationsInSource("await import('node:url');")).toHaveLength(1);
    expect(violationsInSource("import { ALL_OBJECTS } from './lg-catalog-fixture';")).toHaveLength(1);
  });

  it('leaves the forms that cost the browser bundle nothing', () => {
    expect(violationsInSource("import type { BuildLgObject } from './lg-catalog-fixture';")).toEqual([]);
    expect(violationsInSource("import { Scene } from 'three';")).toEqual([]);
    expect(violationsInSource("import { cpuDensityAt } from './local-group-emission-pure';")).toEqual([]);
    expect(violationsInSource("import { starName } from '../../../src/catalog-format/naming/star-naming-pure';"))
      .toEqual([]);
  });
});
