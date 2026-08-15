// gl_FragDepth roster: a static write defeats early-z for the whole
// draw, so only star.frag.glsl may carry one (its halo/member tricks;
// src/client/star-pipeline/README.md § Depth encoding has the contract).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');
const ALLOWED = new Set(['src/client/star-pipeline/star.frag.glsl']);

const writesFragDepth = (path: string): boolean =>
  /gl_FragDepth/.test(readFileSync(path, 'utf8'));

describe('shader frag-depth roster', () => {
  it('no shader outside the allowlist writes gl_FragDepth', () => {
    const offenders = [
      ...walkFiles(join(ROOT, 'src'), { include: (p) => p.endsWith('.glsl') }),
    ]
      .filter((p) => !ALLOWED.has(relative(ROOT, p)) && writesFragDepth(p))
      .map((p) => relative(ROOT, p));
    expect(offenders).toEqual([]);
  });

  it('the allowlist matches reality — shrink it when the port lands', () => {
    for (const p of ALLOWED) {
      const path = join(ROOT, p);
      expect(existsSync(path), `allowlisted shader is gone: ${p}`).toBe(true);
      expect(writesFragDepth(path), `allowlist entry no longer writes: ${p}`).toBe(true);
    }
  });
});
