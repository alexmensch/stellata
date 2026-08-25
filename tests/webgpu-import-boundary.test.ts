// Bundle boundary for the WebGPU dual boot: three/webgpu duplicates
// three's core (~1 MB) and nothing tree-shakes an eagerly-imported
// renderer, so its value imports may exist only inside the async chunk
// behind main.ts's import('./webgpu/boot-webgpu') — see
// src/client/webgpu/README.md § Import boundary.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');
const CLIENT = join(ROOT, 'src', 'client');
const WEBGPU_DIR = join(CLIENT, 'webgpu');

// import / export-from statements with their specifier, tolerant of
// multi-line named lists. Group 1 = 'type ' when type-only, group 2 =
// the module specifier.
const STATIC_IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/g;
// A side-effect import carries no binding list and no `from`, so the regex
// above cannot see it — and it still pulls the whole module into the chunk.
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const isClientSource = (p: string) => p.endsWith('.ts') && !p.endsWith('.test.ts');
const isThreeWebGpuEntry = (spec: string) =>
  spec === 'three/webgpu' || spec === 'three/tsl' || spec.startsWith('three/src/');
// renderer-flag and gate/ are the two exemptions: both must run on a
// browser with no WebGPU at all, so they live in the entry bundle. The
// gate's own guard below is what stops that exemption becoming a hole.
const isWebGpuFolderRef = (spec: string) =>
  /(?:^|\/)webgpu\/(?!renderer-flag$|gate\/)[^'"]+$/.test(spec);

const CROSSING_NOTE =
  '(only renderer-flag, gate/ and type-only imports cross the boundary)';

function violationsInSource(src: string, inWebGpuDir: boolean): string[] {
  if (inWebGpuDir) return [];
  const out: string[] = [];
  const flag = (spec: string, kind: string) => {
    if (isThreeWebGpuEntry(spec)) out.push(`${kind} of ${spec}`);
    else if (isWebGpuFolderRef(spec)) out.push(`${kind} of ${spec} ${CROSSING_NOTE}`);
  };
  for (const [, typeOnly, spec] of src.matchAll(STATIC_IMPORT_RE)) {
    if (!typeOnly) flag(spec, 'value import');
  }
  for (const [, spec] of src.matchAll(BARE_IMPORT_RE)) flag(spec, 'side-effect import');
  for (const [, spec] of src.matchAll(DYNAMIC_IMPORT_RE)) {
    if (isThreeWebGpuEntry(spec)) out.push(`dynamic import of ${spec}`);
  }
  return out;
}

describe('webgpu import boundary', () => {
  it('no value import of three/webgpu or three/tsl leaks outside src/client/webgpu/', () => {
    const offenders: string[] = [];
    for (const p of walkFiles(CLIENT, { include: isClientSource })) {
      const inWebGpuDir = p.startsWith(WEBGPU_DIR);
      for (const v of violationsInSource(readFileSync(p, 'utf8'), inWebGpuDir)) {
        offenders.push(`${relative(ROOT, p)}: ${v}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the boundary is real — the webgpu folder itself imports three/webgpu by value', () => {
    const src = readFileSync(join(WEBGPU_DIR, 'boot-webgpu.ts'), 'utf8');
    expect(/import\s+\{[^}]*\}\s+from\s+'three\/webgpu'/.test(src)).toBe(true);
  });

  // main.ts imports gate/ statically, so the folder is IN the entry bundle.
  // One three/webgpu value import anywhere under it would therefore drag the
  // whole ~1 MB duplicate core in with it — silently, since the sweep above
  // exempts everything inside webgpu/. This is the check that makes the
  // exemption safe rather than a hole in it.
  it('the gate is exempt only because it carries no three/webgpu import', () => {
    const offenders: string[] = [];
    for (const p of walkFiles(join(WEBGPU_DIR, 'gate'), { include: isClientSource })) {
      for (const v of violationsInSource(readFileSync(p, 'utf8'), false)) {
        offenders.push(`${relative(ROOT, p)}: ${v}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the detector itself', () => {
  const outside = (src: string) => violationsInSource(src, false);

  it('catches every import form that would land three/webgpu in the entry', () => {
    expect(outside("import { WebGPURenderer } from 'three/webgpu';")).toHaveLength(1);
    expect(outside("import { uniform } from 'three/tsl';")).toHaveLength(1);
    expect(outside("import type { X } from 'three/src/nodes/tsl/TSLCore.js';\nimport 'three/webgpu';"))
      .toEqual(['side-effect import of three/webgpu']);
    expect(outside("export { WebGPURenderer } from 'three/webgpu';")).toHaveLength(1);
    expect(outside("await import('three/tsl');")).toHaveLength(1);
    expect(outside("import { bootWebGpu } from './webgpu/boot-webgpu';")).toHaveLength(1);
    expect(outside("import './webgpu/boot-webgpu';")).toHaveLength(1);
  });

  it('leaves the forms that cost the WebGL2 bundle nothing', () => {
    expect(outside("import type { WebGPURenderer } from 'three/webgpu';")).toEqual([]);
    expect(outside("import type { WebGpuSeam } from './webgpu/seam';")).toEqual([]);
    expect(outside("import { parseRendererFlag } from './webgpu/renderer-flag';")).toEqual([]);
    // The gate must render where WebGPU does not exist, so it is in the
    // entry bundle by design (guarded above against pulling three in).
    expect(outside("import { showWebGpuGate } from './webgpu/gate/gate-page';")).toEqual([]);
    expect(outside("import { detectWebGpuSupport } from './webgpu/gate/webgpu-support';"))
      .toEqual([]);
    // The exemption is the gate FOLDER, not the name — a sibling that
    // merely starts with those letters still has to go through the chunk.
    expect(outside("import { x } from './webgpu/gatekeeper';")).toHaveLength(1);
    expect(outside("const m = await import('./webgpu/boot-webgpu');")).toEqual([]);
    expect(outside("import { Scene } from 'three';")).toEqual([]);
    expect(violationsInSource("import { WebGPURenderer } from 'three/webgpu';", true)).toEqual([]);
  });
});
