import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = resolve(__dirname, '../scripts/hooks/review-design-reminder.sh');

let stateDir: string;

function run(payload: object): string {
  return execFileSync('bash', [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, TMPDIR: stateDir },
    encoding: 'utf-8',
  });
}

function prompt(text: string, session = 's1'): string | null {
  const stdout = run({ hook_event_name: 'UserPromptSubmit', session_id: session, prompt: text });
  if (stdout.trim() === '') return null;
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
  return parsed.hookSpecificOutput.additionalContext;
}

function skill(name: string, session = 's1'): string {
  return run({
    hook_event_name: 'PreToolUse', session_id: session, tool_name: 'Skill', tool_input: { skill: name },
  });
}

beforeEach(() => {
  stateDir = realpathSync(mkdtempSync(join(tmpdir(), 'review-design-reminder-')));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('review-design-reminder', () => {
  it('stays silent before a review starts', () => {
    expect(prompt('fix the orbit rings')).toBeNull();
  });

  it('arms on /pr-review and reminds on that turn and every later one', () => {
    expect(prompt('/pr-review 610 focus on the map')).toContain('code-craft § Design pass');
    expect(prompt('is there a better way than a regex?')).toContain('*enforced by*');
  });

  it('arms on a scoped slash command', () => {
    expect(prompt('/.claude/worktrees/hhaw-32:pr-review 610')).not.toBeNull();
  });

  it('arms only on the command itself, not a mention or a longer name', () => {
    expect(prompt('please run /pr-review later')).toBeNull();
    expect(prompt('/pr-reviewer 12')).toBeNull();
    expect(prompt('pr-review 610')).toBeNull();
    expect(prompt('/Users/me/.claude/skills/pr-review is odd')).toBeNull();
  });

  it('arms on a Skill call naming pr-review under any scope, and never blocks it', () => {
    expect(skill('cube-css')).toBe('');
    expect(prompt('next')).toBeNull();
    expect(skill('.claude/worktrees/hhaw-32:pr-review')).toBe('');
    expect(prompt('next')).not.toBeNull();
  });

  it('scopes the review to its session', () => {
    prompt('/pr-review 610', 's1');
    expect(prompt('next', 's2')).toBeNull();
  });

  it('stays silent without a session id', () => {
    expect(run({ hook_event_name: 'UserPromptSubmit', prompt: '/pr-review 1' })).toBe('');
  });

  it('keeps the reminder to one line', () => {
    expect(prompt('/pr-review 1')).not.toContain('\n');
  });
});
