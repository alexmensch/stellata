// see /scripts/hooks/README.md#how-pr-body-guard-works

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitFile, gitIn } from './git-fixture';

const HOOK = resolve(__dirname, '../scripts/hooks/pr-body-guard.sh');

let repo: string;
let stubs: string;

const git = (...args: string[]) => gitIn(repo)(...args);

interface PrView {
  readonly base?: string;
  readonly labels?: readonly string[];
  readonly head?: string;
  readonly isDraft?: boolean;
  readonly body?: string;
}

/** `gh pr view` answers with this PR as JSON; the head defaults to the checkout's. */
function ghView({ base = 'main', labels = [], head, isDraft = false, body = '' }: PrView = {}): void {
  const view = {
    baseRefName: base,
    headRefOid: head ?? git('rev-parse', 'HEAD').stdout.trim(),
    labels: labels.map((name) => ({ name })),
    isDraft,
    body,
  };
  writeFileSync(join(stubs, 'view.json'), JSON.stringify(view));
  writeFileSync(join(stubs, 'gh'), `#!/bin/sh\ncat '${join(stubs, 'view.json')}'\n`);
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
      `gh pr create --body-file "${file}" --no-maintainer-edit`,
      `git push -u origin feature && gh pr create -t x -F ${file}`,
      `git push\ngh pr create -F ${file}`,
      `gh pr create \\\n  --title x \\\n  --body-file ${file}`,
      `gh pr create --title "Glow & band; halo | rim" --body-file ${file}`,
      `gh pr create --title 'Glow & band' -F ${file}; git status`,
      `gh pr create -F ${file}&& git status`,
      `GH_PROMPT_DISABLED=1 gh pr create -F ${file}`,
      `env NO_COLOR=1 gh pr create -F ${file}`,
      `command gh pr create -F ${file}`,
      `/opt/homebrew/bin/gh pr create -F ${file}`,
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
      ghView({ labels: ['docs'] });
      expect(decision(`gh pr edit 12 -F ${file}`).denied).toBe(true);
      expect(decision(`gh pr edit 12 -F ${file} --add-label skip-version-bump`).denied).toBe(false);
      ghView({ labels: ['skip-version-bump'] });
      expect(decision(`gh pr edit 12 --title "x y" -F ${file}`).denied).toBe(false);
      expect(decision(`gh pr edit 12 -F ${file} --remove-label skip-version-bump`).denied).toBe(true);
    });
  });

  it('lets a draft open unchecked, since a draft is not claiming to be ready', () => {
    const file = body();
    expect(decision(`gh pr create --draft -F ${file}`).denied).toBe(false);
    expect(decision(`gh pr create -F ${file} -d`).denied).toBe(false);
    expect(decision(`gh pr create -F ${file}`).denied).toBe(true);
  });

  it('lets an edit to a draft PR through, and checks one that is ready', () => {
    const file = body();
    ghView({ isDraft: true });
    expect(decision(`gh pr edit 12 -F ${file}`).denied).toBe(false);
    ghView({ isDraft: false });
    expect(decision(`gh pr edit 12 -F ${file}`).denied).toBe(true);
  });

  it('stands down for a PR into any branch but main, as both workflows do', () => {
    const file = body();
    expect(decision(`gh pr create -B stack-base -F ${file}`).denied).toBe(false);
    ghView({ base: 'stack-base' });
    expect(decision(`gh pr edit 12 -F ${file}`).denied).toBe(false);
    expect(decision(`gh pr edit 12 -F ${file} --base main`).denied).toBe(true);
  });

  describe('judges the head of the PR, not whatever is checked out', () => {
    const PR_HEAD = 'feature';

    beforeEach(() => {
      git('checkout', '-q', '-b', 'elsewhere', 'origin/main');
    });

    it('on edit, from the head commit gh reports', () => {
      const file = body(NOTES);
      ghView({ head: git('rev-parse', PR_HEAD).stdout.trim() });
      const d = decision(`gh pr edit 12 -F ${file}`);
      expect(d.denied).toBe(true);
      expect(d.reason).toContain('src/client/milkyway/band.ts');
      ghView();
      expect(decision(`gh pr edit 12 -F ${file}`).denied).toBe(false);
    });

    it('on create -H, from that branch or its origin copy', () => {
      const file = body(NOTES);
      expect(decision(`gh pr create -F ${file}`).denied).toBe(false);
      expect(decision(`gh pr create -H ${PR_HEAD} -F ${file}`).denied).toBe(true);
      git('update-ref', `refs/remotes/origin/${PR_HEAD}`, PR_HEAD);
      git('branch', '-q', '-D', PR_HEAD);
      expect(decision(`gh pr create --head=${PR_HEAD} -F ${file}`).denied).toBe(true);
    });

    it('stands down on a head this checkout does not hold, rather than judging HEAD', () => {
      git('checkout', '-q', PR_HEAD);
      const file = body(NOTES);
      expect(decision(`gh pr create -F ${file}`).denied).toBe(true);
      ghView({ head: 'deadbeef'.repeat(5) });
      expect(decision(`gh pr edit 12 -F ${file}`).denied).toBe(false);
      expect(decision(`gh pr create -H nowhere -F ${file}`).denied).toBe(false);
      expect(decision(`gh pr create -H someone:${PR_HEAD} -F ${file}`).denied).toBe(false);
    });
  });

  it('reads the branch gh-merge-base config gh itself defaults to on create', () => {
    const file = body();
    git('config', 'branch.feature.gh-merge-base', 'stack-base');
    expect(decision(`gh pr create -F ${file}`).denied).toBe(false);
    expect(decision(`gh pr create -B main -F ${file}`).denied).toBe(true);
  });

  describe('fails open where it cannot judge', () => {
    it('an inline body, stdin, or a file that is not there', () => {
      body();
      for (const command of ['gh pr create --body "x"', 'gh pr create -F -', 'gh pr create -F nowhere.md']) {
        expect(decision(command).denied, command).toBe(false);
      }
    });

    it('a PR in another repository, whose history this checkout does not hold', () => {
      const file = body();
      for (const command of [
        `gh pr create -R someone/fork -F ${file}`,
        `gh pr create --repo=someone/fork -F ${file}`,
        `GH_REPO=someone/fork gh pr create -F ${file}`,
      ]) {
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
    ['release-notes-guard.yml', 'node', 'scripts/release/release-notes-check.ts'],
    ['perf-section-guard.yml', 'bash', 'scripts/perf/perf-section-guard.sh'],
  ])('%s calls %s %s, as the hook does', (workflow, runner, script) => {
    const yml = readFileSync(resolve(__dirname, '../.github/workflows', workflow), 'utf-8');
    expect(yml).toContain(`${runner} ${script}`);
    expect(readFileSync(HOOK, 'utf-8')).toContain(`${runner} "$(check ${script.replace(/^scripts\//, '')})"`);
  });

  it('runs the copies in the checkout the command runs in, as CI runs the branch copies', () => {
    const stubs = {
      'scripts/release/release-notes-check.ts': 'console.log("::error::stub notes"); process.exit(1);\n',
      'scripts/perf/perf-section-guard.sh': 'echo "::error::stub perf"; exit 1\n',
    };
    for (const [script, content] of Object.entries(stubs)) {
      mkdirSync(join(repo, dirname(script)), { recursive: true });
      writeFileSync(join(repo, script), content);
    }
    const d = decision(`gh pr create -F ${body(PERF, NOTES)}`);
    expect(d.denied).toBe(true);
    expect(d.reason).toContain('stub notes');
    expect(d.reason).toContain('stub perf');
  });
});

describe('the hook triggers where the workflows do', () => {
  const hookValue = (name: string): string => {
    const line = new RegExp(`^${name}=(\\S+)$`, 'm').exec(readFileSync(HOOK, 'utf-8'));
    expect(line, `pr-body-guard.sh no longer declares ${name}=`).not.toBeNull();
    return line![1];
  };
  const workflow = (name: string) => readFileSync(resolve(__dirname, '../.github/workflows', name), 'utf-8');

  it.each(['release-notes-guard.yml', 'perf-section-guard.yml'])('%s runs on the base the hook gates', (name) => {
    expect(workflow(name)).toMatch(new RegExp(`^\\s+branches: \\[${hookValue('ci_base')}\\]$`, 'm'));
  });

  it('release-notes-guard.yml skips on the label the hook exempts', () => {
    expect(workflow('release-notes-guard.yml')).toContain(
      `contains(github.event.pull_request.labels.*.name, '${hookValue('skip_label')}')`);
  });
});
