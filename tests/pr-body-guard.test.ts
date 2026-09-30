// see /scripts/hooks/README.md#how-pr-body-guard-works

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitFile, gitIn } from './git-fixture';

const HOOK = resolve(__dirname, '../scripts/hooks/pr-body-guard.sh');

let repo: string;
let stubs: string;

const git = (...args: string[]) => gitIn(repo)(...args);

/** `gh pr view` answers with this base and these labels, one per line. */
function ghView(base: string, ...labels: string[]): void {
  const out = [base, ...labels].join('\n');
  writeFileSync(join(stubs, 'gh'), `#!/bin/sh\nprintf '%s\\n' '${out}'\n`);
  chmodSync(join(stubs, 'gh'), 0o755);
}

function decision(command: string): { denied: boolean; reason: string } {
  const stdout = execFileSync('bash', [HOOK], {
    cwd: tmpdir(),
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: repo }),
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${stubs}:${process.env.PATH}` },
  });
  if (stdout.trim() === '') return { denied: false, reason: '' };
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  return {
    denied: parsed.hookSpecificOutput.permissionDecision === 'deny',
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

const NOTES = '## Release notes\n\n- Stars twinkle.\n';
const PERF = '## Perf\n\nTier 0. No per-frame code is reachable from the diff.\n';

function body(...sections: string[]): string {
  writeFileSync(join(repo, 'body.md'), ['## Summary\n\nx\n', ...sections].join('\n'));
  return 'body.md';
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'pr-body-guard-')));
  stubs = join(repo, '.stubs');
  mkdirSync(stubs);
  git('init', '-q', '-b', 'feature');
  commitFile(repo, 'README.md');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  commitFile(repo, 'src/client/milkyway/band.ts');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('pr-body-guard', () => {
  it('lets every other command through', () => {
    for (const command of ['git status', 'gh pr view 12', 'gh pr checks', 'echo gh pr create']) {
      expect(decision(command).denied, command).toBe(false);
    }
  });

  it('denies a render-path PR whose body lacks the Perf section, with the CI text', () => {
    const d = decision(`gh pr create --title "Band's glow" --body-file ${body(NOTES)}`);
    expect(d.denied).toBe(true);
    expect(d.reason).toContain('perf-section-guard');
    expect(d.reason).toContain("render path touched (src/client/milkyway/band.ts) but the PR body has no non-empty '## Perf' section");
    expect(d.reason).not.toContain('::error::');
  });

  it('passes a conforming body', () => {
    expect(decision(`gh pr create --body-file ${body(PERF, NOTES)}`).denied).toBe(false);
  });

  it('reads every spelling of the body file, anywhere in a chain', () => {
    const file = body(NOTES);
    for (const command of [
      `gh pr create -F ${file}`,
      `gh pr create --body-file=${file}`,
      `gh pr create -F${file}`,
      `gh pr create --body-file "${file}" --draft`,
      `git push -u origin feature && gh pr create -t x -F ${file}`,
      `git push\ngh pr create -F ${file}`,
    ]) {
      expect(decision(command).denied, command).toBe(true);
    }
  });

  it('denies a missing release-notes section, naming both failures together', () => {
    const d = decision(`gh pr create -F ${body()}`);
    expect(d.denied).toBe(true);
    expect(d.reason).toContain("release-notes-guard: PR body must include a non-empty '## Release notes' section");
    expect(d.reason).toContain('perf-section-guard');
  });

  describe('skip-version-bump exempts the release notes, as it does in CI', () => {
    it('on create', () => {
      const file = body(PERF);
      expect(decision(`gh pr create -F ${file}`).denied).toBe(true);
      expect(decision(`gh pr create -F ${file} --label skip-version-bump`).denied).toBe(false);
      expect(decision(`gh pr create -F ${file} -l docs,skip-version-bump`).denied).toBe(false);
    });

    it('on edit, from the labels the PR already carries', () => {
      const file = body(PERF);
      ghView('main', 'docs');
      expect(decision(`gh pr edit 12 -F ${file}`).denied).toBe(true);
      expect(decision(`gh pr edit 12 -F ${file} --add-label skip-version-bump`).denied).toBe(false);
      ghView('main', 'skip-version-bump');
      expect(decision(`gh pr edit 12 --title "x y" -F ${file}`).denied).toBe(false);
      expect(decision(`gh pr edit 12 -F ${file} --remove-label skip-version-bump`).denied).toBe(true);
    });
  });

  it('stands down for a PR into any branch but main, as both workflows do', () => {
    const file = body();
    expect(decision(`gh pr create -B stack-base -F ${file}`).denied).toBe(false);
    ghView('stack-base');
    expect(decision(`gh pr edit 12 -F ${file}`).denied).toBe(false);
    expect(decision(`gh pr edit 12 -F ${file} --base main`).denied).toBe(true);
  });

  describe('fails open where it cannot judge', () => {
    it('an inline body, stdin, or a file that is not there', () => {
      body();
      for (const command of ['gh pr create --body "x"', 'gh pr create -F -', 'gh pr create -F nowhere.md']) {
        expect(decision(command).denied, command).toBe(false);
      }
    });

    it('no origin ref to diff against', () => {
      git('update-ref', '-d', 'refs/remotes/origin/main');
      expect(decision(`gh pr create --label skip-version-bump -F ${body()}`).denied).toBe(false);
    });

    it('an edit whose PR gh cannot read', () => {
      writeFileSync(join(stubs, 'gh'), '#!/bin/sh\nexit 1\n');
      chmodSync(join(stubs, 'gh'), 0o755);
      expect(decision(`gh pr edit 12 -F ${body()}`).denied).toBe(false);
    });
  });
});

describe('CI and the hook run one check each', () => {
  it.each([
    ['release-notes-guard.yml', 'scripts/release/release-notes-check.sh'],
    ['perf-section-guard.yml', 'scripts/perf/perf-section-guard.sh'],
  ])('%s calls %s', (workflow, script) => {
    const yml = readFileSync(resolve(__dirname, '../.github/workflows', workflow), 'utf-8');
    expect(yml).toContain(`bash ${script}`);
    expect(readFileSync(HOOK, 'utf-8')).toContain(script.replace(/^scripts\//, '$here/../'));
  });
});
