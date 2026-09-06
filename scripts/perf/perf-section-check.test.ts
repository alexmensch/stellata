// Behavioural guard for perf-section-check.sh: which files count as a render
// path, and what the `## Perf` section must carry when one is touched.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, 'perf-section-check.sh');
const RELEASING = resolve(__dirname, '../../RELEASING.md');

/** The exempt list as the script spells it: `exempt='a|b|c'`. */
function scriptExemptions(): string[] {
  const line = /^exempt='([^']+)'$/m.exec(readFileSync(SCRIPT, 'utf-8'));
  expect(line, 'perf-section-check.sh no longer declares exempt=').not.toBeNull();
  return line![1].split('|');
}

/** The same list as RELEASING.md § Perf pin states it, which is the design
 *  record the script implements: the backticked `folder/` names in the
 *  sentence naming what neither draws nor decides what is drawn. */
function releasingExemptions(): string[] {
  const text = readFileSync(RELEASING, 'utf-8');
  const sentence = /neither draw nor decide what is\s+drawn:([\s\S]*?)\*\*Naming/.exec(text);
  expect(sentence, 'RELEASING.md § Perf pin no longer names the exempt folders').not.toBeNull();
  return [...sentence![1].matchAll(/`([a-z-]+)\/`/g)].map((m) => m[1]);
}

const EXEMPT_FOLDERS = scriptExemptions();

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
 ~  sol|webgpu     gpu-p50  21.8    21.9     0.1    0.250
 ✗  mw50|webgpu    gpu-p50  31.5    33.2     1.7    0.315
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

describe('the exempt list has exactly one authority', () => {
  it('matches RELEASING.md § Perf pin folder for folder', () => {
    expect([...scriptExemptions()].sort()).toEqual([...releasingExemptions()].sort());
  });

  it('names folders that exist, so a rename cannot silently widen the gate', () => {
    for (const folder of EXEMPT_FOLDERS) {
      const path = resolve(__dirname, '../../src/client', folder);
      expect(readFileSync(join(path, 'README.md'), 'utf-8').length, folder).toBeGreaterThan(0);
    }
  });
});

describe('perf-section-check', () => {
  it('passes a diff that touches no render path, whatever the body says', () => {
    const r = check('## Summary\n\nx\n', ['src/client/ui/panel.ts', 'scripts/perf/run.ts', 'README.md']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('no render path touched');
  });

  it('counts shaders and TypeScript under src/client, not READMEs or tests', () => {
    expect(check('', ['src/client/star-pipeline/README.md', 'src/client/hdr/hdr-pipeline.test.ts']).code).toBe(0);
    const r = check('## Summary\n\nx\n', ['src/client/hdr/hdr-pipeline.ts']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("no non-empty '## Perf' section");
    expect(check('## Summary\n\nx\n', ['src/client/star-pipeline/glow.glsl']).code).toBe(1);
    expect(check('## Summary\n\nx\n', ['src/client/webgpu/tsl/disc.wgsl']).code).toBe(1);
  });

  it('exempts the folders that neither draw nor decide what is drawn', () => {
    for (const folder of EXEMPT_FOLDERS) {
      expect(check('## Summary\n\nx\n', [`src/client/${folder}/thing.ts`]).code).toBe(0);
    }
  });

  it('gates every layer folder the old inclusion list left out', () => {
    // The six the 476 review named, plus the top-level integration shell.
    const missed = [
      'dust', 'molecular-clouds', 'solar-system', 'local-group', 'galactic', 'filters',
    ].map((f) => `src/client/${f}/layer.ts`);
    for (const file of [...missed, 'src/client/stellata.ts']) {
      expect(check('## Summary\n\nx\n', [file]).code, file).toBe(1);
    }
  });

  it('gates a folder nobody has thought of yet — the point of exempting by name', () => {
    expect(check('## Summary\n\nx\n', ['src/client/warp-bubble/renderer.ts']).code).toBe(1);
  });

  it('leaves the page shell and the stylesheet alone', () => {
    expect(check('## Summary\n\nx\n', ['src/client/index.html', 'src/client/styles.css']).code).toBe(0);
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
