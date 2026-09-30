// Behavioural guard for perf-section-check.sh: what counts as a render-path
// change — files, and a catalogue-membership move — and what the `## Perf`
// section must carry when one fires.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitFile, gitIn } from '../../tests/git-fixture';
import { RECORD_COUNT_TOLERANCE } from './diff/diff-pure';

const SCRIPT = resolve(__dirname, 'perf-section-check.sh');
const RELEASING = resolve(__dirname, '../../RELEASING.md');

/** The exempt list as the script spells it: `exempt='a|b|c'`. */
function scriptExemptions(): string[] {
  const line = /^exempt='([^']+)'$/m.exec(readFileSync(SCRIPT, 'utf-8'));
  expect(line, 'perf-section-check.sh no longer declares exempt=').not.toBeNull();
  return line![1].split('|');
}

/** The same list as /RELEASING.md#perf-pin states it, which is the design
 *  record the script implements: the backticked `folder/` names in the
 *  sentence naming what neither draws nor decides what is drawn. */
function releasingExemptions(): string[] {
  const text = readFileSync(RELEASING, 'utf-8');
  const sentence = /neither draw nor decide what is\s+drawn:([\s\S]*?)\*\*Naming/.exec(text);
  expect(sentence, '/RELEASING.md#perf-pin no longer names the exempt folders').not.toBeNull();
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
  it('matches /RELEASING.md#perf-pin folder for folder', () => {
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

  // The row markers are multibyte, and BSD awk in a UTF-8 locale reads a
  // two-byte · as equal to ✗ — so a real table demanded an accepted: line for
  // every unmarked row, failing a body CI passes.
  // Both halves are asserted because mawk on the runner is bytewise anyway
  // and would pass the behavioural case either way. The 📌 line is a first
  // field of a different byte width again: ✗ is three bytes and · two, so a
  // four-byte glyph is the case neither of those would catch.
  it('reads the marker bytewise, so a · row, a doc pointer and a 📌 footer are not marks', () => {
    const table = [
      '## Perf',
      '',
      'pin 194f817d · apple-m4-metal-3 · /RELEASING.md#perf-pin',
      '·  sol|webgpu   wall-p50  16.7    16.7    0    0',
      '✗  mw50|webgpu  gpu-p50   31.451  33.2    1.7  0.315',
      'accepted: mw50|webgpu the new band pass draws at mw50 (bead-7)',
      '',
      '📌 taken on the branch tip, not on main',
      '',
      '## Release notes',
      '',
      '- x',
    ].join('\n');
    const r = check(table, ['src/client/milkyway/band.ts']);
    expect(r.code, r.stdout).toBe(0);
  });

  // The mark is only ever the first field in a pasted table. Prose reports
  // it inline, and a line-start match let such a body through with nothing
  // accepted — so the match is anywhere on the line, and the row is taken
  // from the line's own key.
  describe('a ✗ reported inline', () => {
    const inline = (mark: string, accepted = '') => [
      '## Perf',
      '',
      'pin 194f817d · apple-m4-metal-3 · every context steady',
      `all ~ except ${mark} (compaction, not refill)`,
      ...(accepted === '' ? [] : [accepted]),
      '',
      '## Release notes',
      '',
      '- x',
    ].join('\n');

    it('fails when the marked line names no row an accepted: line could match', () => {
      const r = check(inline('**lg compute +0.44 ✗**'), ['src/client/milkyway/band.ts']);
      expect(r.code, r.stdout).toBe(1);
      expect(r.stdout).toContain('accepted:');
      expect(r.stdout).toContain('unnamed row');
    });

    it('fails a named row without its accepted: line, naming the row', () => {
      const r = check(inline('**lg|webgpu|compute +0.44 ✗**'), ['src/client/milkyway/band.ts']);
      expect(r.code, r.stdout).toBe(1);
      expect(r.stdout).toContain('lg|webgpu|compute');
    });

    it('passes a named row whose accepted: line is present', () => {
      const r = check(
        inline('**lg|webgpu|compute +0.44 ✗**', 'accepted: lg|webgpu|compute compaction got dearer at 1.28M (bead-9)'),
        ['src/client/milkyway/band.ts']);
      expect(r.code, r.stdout).toBe(0);
      expect(r.stdout).toContain('every ✗ accepted');
    });

    it('strips the emphasis around a key, so **key** and `key` read as the row', () => {
      const r = check(
        inline('`mw50|webgpu` +1.7 ✗', 'accepted: mw50|webgpu the new band pass draws at mw50 (bead-7)'),
        ['src/client/milkyway/band.ts']);
      expect(r.code, r.stdout).toBe(0);
    });

    // see /RELEASING.md#what-the-section-carries
    it('fails a section that talks about the marker with the bare character', () => {
      const r = check([
        '## Perf',
        '',
        'Tier 0 — no per-frame code reachable from the frame loop, so no ✗ rows.',
        '',
        '## Release notes',
        '',
        '- x',
      ].join('\n'), ['src/client/milkyway/band.ts']);
      expect(r.code, r.stdout).toBe(1);
      expect(r.stdout).toContain('unnamed row');
    });

    it('passes the marker named alone in a code span', () => {
      const r = check([
        '## Perf',
        '',
        'Tier 0 — no per-frame code reachable from the frame loop, so no `✗` rows.',
        '',
        '## Release notes',
        '',
        '- x',
      ].join('\n'), ['src/client/milkyway/band.ts']);
      expect(r.code, r.stdout).toBe(0);
    });

    it('still marks a code span that names a row beside the character', () => {
      const r = check(inline('`mw50|webgpu +1.7 ✗`'), ['src/client/milkyway/band.ts']);
      expect(r.code, r.stdout).toBe(1);
      expect(r.stdout).toContain('mw50|webgpu');
    });

    it('still marks a bare ✗ on a line that also names the glyph in a code span', () => {
      const r = check(inline('lg|webgpu +0.4 ✗, per the `✗` convention'), ['src/client/milkyway/band.ts']);
      expect(r.code, r.stdout).toBe(1);
      expect(r.stdout).toContain('lg|webgpu');
    });

    it('passes the same claim written without the character', () => {
      const r = check([
        '## Perf',
        '',
        'Tier 0 — no per-frame code reachable from the frame loop; every row within band.',
        '',
        '## Release notes',
        '',
        '- x',
      ].join('\n'), ['src/client/milkyway/band.ts']);
      expect(r.code, r.stdout).toBe(0);
    });
  });

  // /RELEASING.md#perf-pin promises Tier 0 a prose reachability argument
  // in place of a table. Nothing in the script had to change for that — a
  // body with no table has no ✗ — but the promise is now written down, so
  // it gets a test rather than resting on the guard happening to allow it.
  it('accepts a Tier 0 body that argues reachability instead of tabling it', () => {
    const body = [
      '## Perf',
      '',
      'Tier 0. aimAlong and beginNavigateAim run on a keypress; tick() is',
      'untouched, and no pass, draw count or per-frame buffer write is',
      'reachable from the diff.',
      '',
      '## Release notes',
      '',
      '- x',
    ].join('\n');
    const r = check(body, ['src/client/camera/aim.ts']);
    expect(r.code, r.stdout).toBe(0);
    expect(r.stdout).toContain('every ✗ accepted');
  });

  describe('a Tier 1 or Tier 2 claim carries the table', () => {
    const section = (...lines: string[]) =>
      ['## Summary', '', 'x', '', '## Perf', '', ...lines, '', '## Release notes', '', '- x'].join('\n');
    const RENDER = ['src/client/milkyway/band.ts'];

    it('fails a claim that promises the run instead of pasting it', () => {
      for (const tier of ['Tier 1', '**Tier 2**']) {
        const r = check(section(`${tier} — the catalogue changed. Needs a run before merge.`), RENDER);
        expect(r.code, tier).toBe(1);
        expect(r.stdout).toContain('carries no --against-pin table row');
      }
    });

    it('passes a claim whose table has a row, marked or not', () => {
      const table = PERF_SECTION.replace('## Perf\n', '## Perf\n\nTier 2 — the catalogue changed.\n');
      expect(check(table, RENDER).code).toBe(0);
      const tier1 = section('Tier 1, pin 09b675c2', ' ~  mw120|webgpu  wall-p50  8.3  8.3  0  0.250',
        ' ~  sol|webgpu    gpu-p50   21.8  21.9  0.1  0.250');
      expect(check(tier1, RENDER).code).toBe(0);
    });

    it('does not count a row key in prose as a table row', () => {
      const r = check(section('Tier 2; mw50|webgpu is the row most likely to move.'), RENDER);
      expect(r.code, r.stdout).toBe(1);
    });

    it('reads the first tier named as the claim', () => {
      const r = check(section('Tier 0 — keypress handlers only, so no Tier 2 sweep.'), RENDER);
      expect(r.code, r.stdout).toBe(0);
    });

    it('applies to a membership trigger the same way', () => {
      const r = check(section('Tier 2. Needs a run before merge.'), [], pair(RECORDS, 420_000));
      expect(r.code).toBe(1);
      expect(r.stdout).toContain('catalogue membership');
    });
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

describe('perf-section-guard gathers the inputs from git', () => {
  const GUARD = resolve(__dirname, 'perf-section-guard.sh');
  const git = (...args: string[]) => gitIn(repo)(...args);
  const commit = (path: string, content?: string) => commitFile(repo, path, content);

  const expected = (n: number) => JSON.stringify({ recordCount: n });

  function guard(body: string): Exit {
    writeFileSync(join(repo, 'body.md'), body);
    const r = spawnSync('bash', [GUARD, 'body.md', 'base'], { cwd: repo, encoding: 'utf-8' });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  beforeEach(() => {
    git('init', '-q', '-b', 'main');
    commit('scripts/catalog/build-catalog-expected.json', expected(RECORDS));
    git('branch', 'base');
  });

  it('reads the files HEAD changed since the base', () => {
    commit('src/client/milkyway/band.ts', 'x');
    const r = guard('## Summary\n\nx\n');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('render path touched (src/client/milkyway/band.ts)');
  });

  it('ignores what the base gained after the branch point', () => {
    git('checkout', '-q', 'base');
    commit('src/client/milkyway/band.ts', 'x');
    git('checkout', '-q', 'main');
    commit('README.md', 'x');
    expect(guard('## Summary\n\nx\n').code).toBe(0);
  });

  it('reads the record count off both refs', () => {
    commit('scripts/catalog/build-catalog-expected.json', expected(420_000));
    const r = guard('## Summary\n\nx\n');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('catalogue membership 388063 -> 420000');
  });
});
