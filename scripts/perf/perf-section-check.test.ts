// Behavioural guard for perf-section-check.sh: which files count as a render
// path, and what the `## Perf` section must carry when one is touched.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, 'perf-section-check.sh');

let repo: string;

interface Exit { code: number | null; stdout: string; stderr: string }

function check(body: string, files: readonly string[]): Exit {
  writeFileSync(join(repo, 'body.md'), body);
  writeFileSync(join(repo, 'changed.txt'), `${files.join('\n')}\n`);
  const r = spawnSync('bash', [SCRIPT, 'body.md', 'changed.txt'], { cwd: repo, encoding: 'utf-8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const PERF_SECTION = `## Summary

x

## Perf

<!-- template scaffolding -->
pin 09b675c2 · apple-m4-metal-3 · every context steady
    row            metric   pinned  current  delta  band
 ~  sol|webgpu     gpu-p50  21.8    21.9     0.1    0.654
 ✗  mw50|webgpu    gpu-p50  31.5    33.2     1.7    0.945
accepted: mw50|webgpu the new band pass draws at mw50 (bead-7)

## Release notes

- …
`;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'perf-section-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('perf-section-check', () => {
  it('passes a diff that touches no render path, whatever the body says', () => {
    const r = check('## Summary\n\nx\n', ['src/client/ui/panel.ts', 'scripts/perf/run.ts', 'README.md']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('no render path touched');
  });

  it('counts shaders and the render folders, not their READMEs or tests', () => {
    expect(check('', ['src/client/star-pipeline/README.md', 'src/client/hdr/hdr-pipeline.test.ts']).code).toBe(0);
    const r = check('## Summary\n\nx\n', ['src/client/hdr/hdr-pipeline.ts']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("no non-empty '## Perf' section");
    expect(check('## Summary\n\nx\n', ['src/client/star-pipeline/glow.glsl']).code).toBe(1);
    expect(check('## Summary\n\nx\n', ['src/client/webgpu/tsl/disc.wgsl']).code).toBe(1);
  });

  it('counts a file outside those folders when it calls renderer.render', () => {
    mkdirSync(join(repo, 'src/client/attitude'), { recursive: true });
    writeFileSync(join(repo, 'src/client/attitude/ball.ts'), 'renderer.render(scene, view);\n');
    writeFileSync(join(repo, 'src/client/attitude/pure.ts'), 'export const x = 1;\n');
    expect(check('## Summary\n\nx\n', ['src/client/attitude/ball.ts']).code).toBe(1);
    expect(check('## Summary\n\nx\n', ['src/client/attitude/pure.ts']).code).toBe(0);
  });

  it('does not count template scaffolding as content', () => {
    const r = check('## Perf\n\n<!-- paste the table -->\n\n## Release notes\n', ['src/client/scene/graph.ts']);
    expect(r.code).toBe(1);
  });

  it('passes a section whose every ✗ row has an accepted: line', () => {
    const r = check(PERF_SECTION, ['src/client/milkyway/band.ts']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('every ✗ accepted');
  });

  it('fails a ✗ row without its accepted: line, naming the row', () => {
    const r = check(PERF_SECTION.replace(/^accepted:.*\n/m, ''), ['src/client/milkyway/band.ts']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('mw50|webgpu');
    expect(r.stdout).toContain('accepted:');
  });
});
