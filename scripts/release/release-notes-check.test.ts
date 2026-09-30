// Behavioural guard for release-notes-check.sh: the `## Release notes`
// section release-notes-guard demands.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractReleaseNotes } from './release-plan-pure';

const SCRIPT = resolve(__dirname, 'release-notes-check.sh');

let dir: string;

function check(body: string): { code: number | null; stdout: string } {
  const file = join(dir, 'body.md');
  writeFileSync(file, body);
  const r = spawnSync('bash', [SCRIPT, file], { encoding: 'utf-8' });
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
      expect(r.stdout).toContain('PR body is empty');
    }
  });

  it('fails a body without the section', () => {
    const r = check('## Summary\n\nx\n');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("non-empty '## Release notes' section");
  });

  it('does not count template scaffolding as content', () => {
    const r = check('## Release notes\n\n<!-- Summary\n  New features -->\n\n## Perf\n\nTier 0\n');
    expect(r.code).toBe(1);
  });

  it('reads the section only up to the next heading', () => {
    expect(check('## Release notes\n\n## Perf\n\nTier 0\n').code).toBe(1);
  });

  it('passes a section with content, wherever it sits', () => {
    expect(check('## Summary\n\nx\n\n## Release notes\n\n- Stars twinkle.\n').code).toBe(0);
    const r = check('## Release notes\n\n- Stars twinkle.\n\n## Perf\n\nTier 0\n');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('present and non-empty');
  });
});

describe('the guard and the deploy read the same section', () => {
  it.each([
    '## Summary\n\nx\n',
    '## Release notes\n\n<!-- Summary -->\n\n## Perf\n\nTier 0\n',
    '## Release notes\n\n## Perf\n\nTier 0\n',
    '## Release notes  \n\n- Stars twinkle.\n',
    '## Summary\n\nx\n\n## Release notes\n\n- Stars twinkle.\n\n## Perf\n\nx\n',
  ])('agrees with extractReleaseNotes on %j', (body) => {
    expect(check(body).code === 0).toBe(extractReleaseNotes(body) !== null);
  });
});
