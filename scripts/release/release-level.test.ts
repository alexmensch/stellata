import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, 'release-level.ts');

function level(labels: string[]): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT], { input: labels.map((l) => `${l}\n`).join(''), encoding: 'utf-8' });
  return { code: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

describe('release-level', () => {
  it('prints the declared level', () => {
    expect(level(['docs', 'release:minor'])).toMatchObject({ code: 0, stdout: 'minor' });
    expect(level(['skip-version-bump'])).toMatchObject({ code: 0, stdout: 'none' });
  });

  it('fails a PR with no level label', () => {
    const r = level(['docs']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('::error::no release level declared');
  });

  it('fails a PR with two level labels', () => {
    const r = level(['release:patch', 'skip-version-bump']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('::error::release:patch and skip-version-bump conflict');
  });
});
