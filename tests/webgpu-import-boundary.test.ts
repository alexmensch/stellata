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
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const isClientSource = (p: string) => p.endsWith('.ts') && !p.endsWith('.test.ts');
const isThreeWebGpuEntry = (spec: string) =>
  spec === 'three/webgpu' || spec === 'three/tsl' || spec.startsWith('three/src/');
const isWebGpuFolderRef = (spec: string) => /(?:^|\/)webgpu\/(?!renderer-flag$)[^'"]+$/.test(spec);

function violationsIn(path: string): string[] {
  const src = readFileSync(path, 'utf8');
  const inWebGpuDir = path.startsWith(WEBGPU_DIR);
  const out: string[] = [];
  for (const m of src.matchAll(STATIC_IMPORT_RE)) {
    const [, typeOnly, spec] = m;
    if (typeOnly) continue;
    if (!inWebGpuDir && isThreeWebGpuEntry(spec)) out.push(`value import of ${spec}`);
    if (!inWebGpuDir && isWebGpuFolderRef(spec)) {
      out.push(`static import of ${spec} (only renderer-flag and type-only imports cross the boundary)`);
    }
  }
  for (const m of src.matchAll(DYNAMIC_IMPORT_RE)) {
    if (!inWebGpuDir && isThreeWebGpuEntry(m[1])) out.push(`dynamic import of ${m[1]}`);
  }
  return out;
}

describe('webgpu import boundary', () => {
  it('no value import of three/webgpu or three/tsl leaks outside src/client/webgpu/', () => {
    const offenders: string[] = [];
    for (const p of walkFiles(CLIENT, { include: isClientSource })) {
      for (const v of violationsIn(p)) offenders.push(`${relative(ROOT, p)}: ${v}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the boundary is real — the webgpu folder itself imports three/webgpu by value', () => {
    const src = readFileSync(join(WEBGPU_DIR, 'boot-webgpu.ts'), 'utf8');
    expect(/import\s+\{[^}]*\}\s+from\s+'three\/webgpu'/.test(src)).toBe(true);
  });
});
