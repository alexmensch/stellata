// Frag-depth roster for TSL pipelines — the successor to the GLSL text
// scan in shader-frag-depth.test.ts, which keeps guarding the live GLSL
// until the WebGL2 path is deleted (the two coexist until then). Any
// fragment-stage depth write disables early-z for the whole WebGPU
// pipeline, and the depth-honest redesign's whole point is that NO star
// pipeline writes it (src/client/webgpu/README.md § Early-z) — so the
// allowlist starts, and should stay, empty.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');
const ALLOWED = new Set<string>([]);

const GUIDANCE =
  'writes fragment depth from TSL. Per-instance stamps belong in the vertex '
  + 'stage as a clip-z pin (the D3 core-mask pattern); a draw that wanted to '
  + 'yield depth per fragment should write none and read an earlier '
  + "depth-only draw's stamp instead (the D4 disc pattern — "
  + 'src/client/webgpu/star/README.md § The disc draw writes no depth). A '
  + 'second draw over the same instances is NOT the answer: it prices the '
  + 'port above the renderer it replaces. If a write is genuinely '
  + 'unavoidable, allowlist it here with the early-z cost stated.';

// The three ways a node material writes fragment depth: assigning its
// depthNode, passing depthNode in a constructor/params literal, and the
// raw WGSL builtin. `==`/`===` comparisons are reads, not writes.
const WRITE_FORMS = [
  /\.depthNode\s*=(?!=)/,
  /\bdepthNode\s*:/,
  /frag_depth/,
];

export function writesTslFragDepth(src: string): boolean {
  return WRITE_FORMS.some((re) => re.test(src));
}

const isProductionTs = (p: string) =>
  p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts');

describe('TSL frag-depth roster', () => {
  it('no module outside the allowlist writes fragment depth', () => {
    const offenders = [...walkFiles(join(ROOT, 'src'), { include: isProductionTs })]
      .filter((p) => !ALLOWED.has(relative(ROOT, p)) && writesTslFragDepth(readFileSync(p, 'utf8')))
      .map((p) => `${relative(ROOT, p)} ${GUIDANCE}`);
    expect(offenders).toEqual([]);
  });
});

describe('the detector itself', () => {
  it('catches every form that writes fragment depth', () => {
    expect(writesTslFragDepth('material.depthNode = viewZToPerspectiveDepth(z);')).toBe(true);
    expect(writesTslFragDepth('new NodeMaterial({ depthNode: pin })')).toBe(true);
    expect(writesTslFragDepth("builtin('frag_depth')")).toBe(true);
    expect(writesTslFragDepth('material.depthNode\n  = something')).toBe(true);
  });

  it('leaves reads and depth-state flags alone', () => {
    expect(writesTslFragDepth('expect(material.depthNode).toBe(null)')).toBe(false);
    expect(writesTslFragDepth('if (material.depthNode === null) {}')).toBe(false);
    expect(writesTslFragDepth('material.depthWrite = false;')).toBe(false);
    expect(writesTslFragDepth('material.depthTest = true;')).toBe(false);
    expect(writesTslFragDepth('const depthNodeless = 1;')).toBe(false);
  });
});
