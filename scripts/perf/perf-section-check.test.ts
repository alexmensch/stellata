// Behavioural guard for perf-section-check.sh: what counts as a render-path
// change — files, and a catalogue-membership move — and what the `## Perf`
// section must carry when one fires.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RECORD_COUNT_TOLERANCE } from './diff-pure';

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

function check(body: string, files: readonly string[], records?: readonly [string, string]): Exit {
  writeFileSync(join(repo, 'body.md'), body);
  writeFileSync(join(repo, 'changed.txt'), `${files.join('\n')}\n`);
  const argv = [SCRIPT, 'body.md', 'changed.txt', ...(records ?? [])];
  const r = spawnSync('bash', argv, { cwd: repo, encoding: 'utf-8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The tolerance as the script spells it: `record_tolerance_percent=N`. */
function scriptRecordTolerance(): number {
  const line = /^record_tolerance_percent=(\d+)$/m.exec(readFileSync(SCRIPT, 'utf-8'));
  expect(line, 'perf-section-check.sh no longer declares record_tolerance_percent=').not.toBeNull();
  return Number(line![1]) / 100;
}

const RECORDS = 388_063;
const pair = (base: number, head: number): [string, string] => [String(base), String(head)];

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

  // The row markers are multibyte, and BSD awk in a UTF-8 locale reads · and
  // § as equal to ✗ — so a real table demanded an accepted: line for every
  // unmarked row and for the § in a doc pointer, failing a body CI passes.
  // Both halves are asserted because mawk on the runner is bytewise anyway
  // and would pass the behavioural case either way.
  it('reads the marker bytewise, so a · row and a § pointer are not marks', () => {
    const table = [
      '## Perf',
      '',
      'pin 194f817d · apple-m4-metal-3 · RELEASING.md § Perf pin',
      '·  sol|webgl2   wall-p50  16.7    16.7    0    0',
      '✗  mw50|webgpu  gpu-p50   31.451  33.2    1.7  0.315',
      'accepted: mw50|webgpu the new band pass draws at mw50 (bead-7)',
      '',
      '## Release notes',
      '',
      '- x',
    ].join('\n');
    const r = check(table, ['src/client/milkyway/band.ts']);
    expect(r.code, r.stdout).toBe(0);
  });

  it('declares that locale itself, so the caller-s awk cannot decide it', () => {
    expect(readFileSync(SCRIPT, 'utf-8')).toMatch(/^export LC_ALL=C$/m);
  });
});

describe('catalogue membership is a render-path trigger of its own', () => {
  it('shares its bound with the refusal, so neither can deadlock the other', () => {
    expect(scriptRecordTolerance()).toBe(RECORD_COUNT_TOLERANCE);
  });

  it('gates a membership change past the bound, with no render-path file at all', () => {
    const r = check('## Summary\n\nx\n', ['scripts/catalog/build-catalog-expected.json'], pair(RECORDS, 420_000));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('catalogue membership 388063 -> 420000');
    expect(r.stdout).toContain("no non-empty '## Perf' section");
  });

  it('passes a membership change inside the bound', () => {
    const inside = RECORDS + Math.floor(RECORDS * RECORD_COUNT_TOLERANCE) - 1;
    const r = check('## Summary\n\nx\n', ['scripts/catalog/build-catalog-expected.json'], pair(RECORDS, inside));
    expect(r.code, r.stdout).toBe(0);
    expect(r.stdout).toContain('membership within 1 %');
  });

  it('reads the bound in both directions, so a shrunken catalogue gates too', () => {
    const shrunk = RECORDS - Math.ceil(RECORDS * RECORD_COUNT_TOLERANCE) - 1;
    expect(check('## Summary\n\nx\n', [], pair(RECORDS, shrunk)).code).toBe(1);
    expect(check('## Summary\n\nx\n', [], pair(RECORDS, RECORDS - 100)).code).toBe(0);
  });

  it('accepts the same section a render-path diff would', () => {
    expect(check(PERF_SECTION, [], pair(RECORDS, 420_000)).code).toBe(0);
  });

  it('names both triggers when a diff fires both', () => {
    const r = check('## Summary\n\nx\n', ['src/client/milkyway/band.ts'], pair(RECORDS, 420_000));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('render path touched');
    expect(r.stdout).toContain('catalogue membership');
  });

  // Unreadable counts leave the check silent rather than failing every PR
  // that does not pass them: the comparison-time refusal is the backstop, and
  // a guard that cannot be run without two extra arguments would be dropped.
  it('stays silent on absent, empty or non-numeric counts', () => {
    expect(check('## Summary\n\nx\n', []).code).toBe(0);
    for (const bad of [['', ''], [String(RECORDS), ''], ['null', String(RECORDS)], ['0', '420000']]) {
      const r = check('## Summary\n\nx\n', [], bad as [string, string]);
      expect(r.code, bad.join('/')).toBe(0);
    }
  });
});
