// Behavioural guard for release-notes-check.ts: the `## Release notes`
// section release-notes-guard demands, run as CI runs it.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, 'release-notes-check.ts');

let dir: string;

function check(body: string): { code: number | null; stdout: string } {
  const file = join(dir, 'body.md');
  writeFileSync(file, body);
  const r = spawnSync('node', [SCRIPT, file], { encoding: 'utf-8' });
  return { code: r.status, stdout: r.stdout };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('release-notes-check', () => {
  it('fails an empty body with its own message', () => {
    for (const body of ['', '\n\n  \n']) {
      const r = check(body);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain('::error::PR body is empty');
    }
  });

  it('fails a body without the section', () => {
    const r = check('## Summary\n\nx\n');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("::error::PR body must include a non-empty '## Release notes' section");
  });

  it('does not count template scaffolding as content, nested comments included', () => {
    expect(check('## Release notes\n\n<!-- Summary\n  New features -->\n\n## Perf\n\nTier 0\n').code).toBe(1);
    expect(check('## Release notes\n\n<!<!-- a -->-- b -->\n').code).toBe(1);
  });

  it('reads the section only up to the next heading', () => {
    expect(check('## Release notes\n\n## Perf\n\nTier 0\n').code).toBe(1);
  });

  it('passes a section with content, wherever it sits', () => {
    expect(check('## Summary\n\nx\n\n## Release notes\n\n- Stars twinkle.\n').code).toBe(0);
    const r = check('## Release notes  \n\n- Stars twinkle.\n\n## Perf\n\nTier 0\n');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('present and non-empty');
  });
});

describe('runs under plain node, with nothing installed', () => {
  it.each(['release-notes-check.ts', 'release-plan-pure.ts'])('%s imports only node builtins and siblings', (file) => {
    const source = readFileSync(resolve(__dirname, file), 'utf-8');
    for (const [, spec] of source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      expect(spec, `${file} imports ${spec}`).toMatch(/^(node:|\.\/[\w-]+\.ts$)/);
    }
  });
});
