// gl_FragDepth roster: a static write defeats early-z for the whole
// draw, so only star.frag.glsl may carry one (its halo/member tricks;
// src/client/star-pipeline/README.md § Depth encoding has the contract).
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const ALLOWED = new Set(['src/client/star-pipeline/star.frag.glsl']);

function* glslFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* glslFiles(path);
    else if (path.endsWith('.glsl')) yield path;
  }
}

describe('shader frag-depth roster', () => {
  it('no shader outside the allowlist writes gl_FragDepth', () => {
    const offenders = [...glslFiles(join(ROOT, 'src'))]
      .map((p) => relative(ROOT, p))
      .filter((p) => !ALLOWED.has(p))
      .filter((p) => /gl_FragDepth/.test(readFileSync(join(ROOT, p), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the allowlist matches reality — shrink it when the port lands', () => {
    for (const p of ALLOWED) {
      expect(readFileSync(join(ROOT, p), 'utf8')).toMatch(/gl_FragDepth/);
    }
  });
});
