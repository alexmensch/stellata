// Behavioural guard for scripts/hooks/commit-sweep-guard.sh: the commit-time
// README sweep must fire on a stale folder README and must honour the
// readme-skip opt-out however the commit message reached git.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = resolve(__dirname, '../scripts/hooks/commit-sweep-guard.sh');

const SKIP_REASON = '[readme-skip: every claim in it still holds]';

let repo: string;

function git(...args: string[]): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: repo,
    stdio: 'ignore',
  });
}

function write(rel: string, body = 'placeholder\n'): void {
  const full = join(repo, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function allowed(command: string): boolean {
  const stdout = execFileSync('bash', [HOOK], {
    cwd: repo,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf-8',
  });
  if (stdout.trim() === '') return true;
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { permissionDecision: string };
  };
  return parsed.hookSpecificOutput.permissionDecision !== 'deny';
}

/** A staged change under a guarded folder whose README is NOT in the commit
 *  — the state the sweep exists to catch. */
function stageStaleChange(): void {
  write('src/thing/README.md', '# thing\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  write('src/thing/thing.ts', 'export const x = 1;\n');
  git('add', '-A');
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'commit-sweep-repo-')));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'guard@example.test');
  git('config', 'user.name', 'Guard');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('commit-sweep-guard', () => {
  it('lets a non-commit Bash call straight through', () => {
    stageStaleChange();
    expect(allowed('git status -sb')).toBe(true);
  });

  it('denies a commit that leaves its folder README stale', () => {
    stageStaleChange();
    expect(allowed('git commit -m "add a thing"')).toBe(false);
  });

  it('honours the skip tag in an inline -m message', () => {
    stageStaleChange();
    expect(allowed(`git commit -m "add a thing ${SKIP_REASON}"`)).toBe(true);
  });

  // The regression this file was added for. A worktree-isolated session
  // cannot pass a long message any other way: the worktree guard rejects
  // `$( )` substitution and heredoc bodies, so -F is the only route left
  // and the tag lives where only the file can carry it.
  it('honours the skip tag inside a -F message file', () => {
    stageStaleChange();
    const msg = join(repo, 'msg.txt');
    writeFileSync(msg, `add a thing\n\n${SKIP_REASON}\n`);
    expect(allowed(`git commit -F ${msg}`)).toBe(true);
  });

  it('honours it for --file= and a -F file whose reason wraps lines', () => {
    stageStaleChange();
    const msg = join(repo, 'msg.txt');
    writeFileSync(msg, '[readme-skip: the reason\nwraps across lines]\n');
    expect(allowed(`git commit --file=${msg}`)).toBe(true);
  });

  it('still denies when the -F file carries no tag', () => {
    stageStaleChange();
    const msg = join(repo, 'msg.txt');
    writeFileSync(msg, 'add a thing, no opt-out here\n');
    expect(allowed(`git commit -F ${msg}`)).toBe(false);
  });

  it('does not fall over when the -F file does not exist', () => {
    stageStaleChange();
    expect(allowed(`git commit -F ${join(repo, 'absent.txt')}`)).toBe(false);
  });
});

// The comment sweep compiles scripts/hooks/comment-rules.json through Perl
// qr//, while tests/code-comment-rules.test.ts compiles the same strings
// through JavaScript RegExp. Only a case run through the hook proves the two
// dialects agree — the two hand-copied sets that preceded that shared file
// had already drifted apart (scripts/hooks/README.md).
describe('commit-sweep-guard — the comment patterns, through Perl', () => {
  function stageComment(line: string): void {
    write('src/thing/README.md', '# thing\n');
    write('src/thing/thing.ts', 'export const x = 1;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');
    write('src/thing/thing.ts', `${line}\nexport const x = 1;\n`);
    git('add', '-A');
  }

  // Every fixture below splices its slug in at run time. Written literally,
  // each would be scanned by this very hook on the commit that adds it —
  // the bead IDs because they are bead IDs, the exempt pair because the hook
  // registered in .claude/settings.json reads the MAIN checkout's rules,
  // which do not carry the exemption until this lands. What reaches the
  // staged file the hook under test inspects is the real string either way.
  const BEAD_ID = `stellata-${'8cg'}.49`;
  const SCHEMA = `stellata-${'perf'}/1`;
  const SKILL_DIR = `.claude/skills/stellata-${'perf'}`;

  it('denies a staged bead ID', () => {
    stageComment(`// per the ${BEAD_ID} probe`);
    expect(allowed(`git commit -m "a thing ${SKIP_REASON}"`)).toBe(false);
  });

  it('allows a trailing-slash namespace, which no bead ID ever wears', () => {
    stageComment(`const PERF_SCHEMA = '${SCHEMA}';`);
    expect(allowed(`git commit -m "a thing ${SKIP_REASON}"`)).toBe(true);
  });

  it('allows a path under a same-shaped skill folder', () => {
    stageComment(`// the arm protocol lives in ${SKILL_DIR}/SKILL.md`);
    expect(allowed(`git commit -m "a thing ${SKIP_REASON}"`)).toBe(true);
  });

  it('still catches a bead ID that happens to sit inside a path', () => {
    stageComment(`// see notes/${BEAD_ID}/summary.md`);
    expect(allowed(`git commit -m "a thing ${SKIP_REASON}"`)).toBe(false);
  });
});

describe('restatement sweep', () => {
  const DOC = `# thing

An edit to a page here reloads the browser, and that takes the plugin's own
watcher wiring rather than Vite's: this folder is outside the app server's
root, so nothing here is watched by default, and Vite's own HTML reload
addresses a page by its path relative to that root — which no URL served
from here matches.
`;

  const RESTATES = `// These pages sit outside this server's root, so Vite's watcher never
// reaches them and an edit fires no reload at all. Vite's own html
// handling would not help even once watched: it sends a path relative
// to root, and the page the browser is on never matches.
export const x = 1;
`;

  // Spliced for the same reason the bead IDs above are: written literally
  // this is a doc pointer into a fixture path, and
  // tests/doc-pointer-resolution.test.ts resolves every one it finds.
  const POINTER = `src/thing/README.md${'#'}reading-it-in-dev`;

  const POINTS = `// Not Vite's own html reload: ${POINTER}.
export const x = 1;
`;

  function stagePair(code: string): void {
    write('src/thing/README.md', '# thing\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');
    write('src/thing/README.md', DOC);
    write('src/thing/thing.ts', code);
    git('add', '-A');
  }

  it('denies a comment that restates prose the same commit adds', () => {
    stagePair(RESTATES);
    expect(allowed('git commit -m "wire the reload"')).toBe(false);
  });

  it('allows the one-line pointer that replaces it', () => {
    stagePair(POINTS);
    expect(allowed('git commit -m "wire the reload"')).toBe(true);
  });

  it('honours the comment-ok opt-out', () => {
    stagePair(RESTATES);
    const ok = '[comment-ok: the block carries an invariant the prose does not]';
    expect(allowed(`git commit -m "wire it ${ok}"`)).toBe(true);
  });

  // Overlap with prose the commit does NOT touch is not evidence of
  // anything; the prose has to be arriving alongside the comment.
  it('stays quiet when the commit adds no markdown', () => {
    write('src/thing/README.md', DOC);
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');
    write('src/thing/thing.ts', RESTATES);
    git('add', '-A');
    expect(allowed(`git commit -m "a thing ${SKIP_REASON}"`)).toBe(true);
  });
});
