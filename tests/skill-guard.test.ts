// Behaviour of scripts/hooks/skill-guard.sh — see scripts/hooks/README.md § How skill-guard works.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = resolve(__dirname, '../scripts/hooks/skill-guard.sh');

let stateDir: string;

interface Decision {
  allowed: boolean;
  reason: string;
}

function run(payload: object): Decision {
  const stdout = execFileSync('bash', [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, TMPDIR: stateDir, GUARD_SESSION: 'test' },
    encoding: 'utf-8',
  });
  if (stdout.trim() === '') return { allowed: true, reason: '' };
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  return {
    allowed: parsed.hookSpecificOutput.permissionDecision !== 'deny',
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

function edit(filePath: string): Decision {
  return run({ tool_name: 'Edit', tool_input: { file_path: filePath } });
}

function skill(name: string): Decision {
  return run({ tool_name: 'Skill', tool_input: { skill: name } });
}

beforeEach(() => {
  stateDir = realpathSync(mkdtempSync(join(tmpdir(), 'skill-guard-')));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('skill-guard / cube-css', () => {
  it('blocks a stylesheet edit before the skill is invoked', () => {
    const decision = edit('/repo/src/site/site.css');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('cube-css');
  });

  it('allows the edit once the skill has been invoked', () => {
    expect(skill('cube-css').allowed).toBe(true);
    expect(edit('/repo/src/site/site.css').allowed).toBe(true);
  });

  it('accepts a directory-scoped spelling of the skill name', () => {
    expect(skill('src/site:cube-css').allowed).toBe(true);
    expect(edit('/repo/src/site/site.css').allowed).toBe(true);
  });

  it('is not armed by a different skill', () => {
    expect(skill('utopia').allowed).toBe(true);
    expect(edit('/repo/src/site/site.css').allowed).toBe(false);
  });

  it('does not arm the gate on a code file', () => {
    expect(skill('cube-css').allowed).toBe(true);
    expect(edit('/repo/src/a.ts').allowed).toBe(false);
  });

  it('gates Write and NotebookEdit on their own path keys', () => {
    expect(run({ tool_name: 'Write', tool_input: { file_path: '/repo/a.css' } }).allowed)
      .toBe(false);
    expect(run({ tool_name: 'NotebookEdit', tool_input: { notebook_path: '/repo/a.css' } }).allowed)
      .toBe(false);
  });

  it('passes a payload carrying no path at all', () => {
    expect(run({ tool_name: 'Edit', tool_input: {} }).allowed).toBe(true);
  });
});

describe('skill-guard / code-craft', () => {
  const CODE_FILES = [
    '/repo/src/a.ts', '/repo/src/a.tsx', '/repo/a.js', '/repo/a.mjs', '/repo/a.cjs',
    '/repo/scripts/a.py', '/repo/scripts/hooks/a.sh', '/repo/src/a.wgsl', '/repo/src/a.glsl',
  ];

  it('blocks every code file before the skill is invoked', () => {
    for (const path of CODE_FILES) {
      const decision = edit(path);
      expect(decision.allowed, path).toBe(false);
      expect(decision.reason, path).toContain('code-craft');
    }
  });

  it('allows every code file once the skill has been invoked', () => {
    expect(skill('code-craft').allowed).toBe(true);
    for (const path of CODE_FILES) expect(edit(path).allowed, path).toBe(true);
  });

  it('does not arm the stylesheet gate', () => {
    expect(skill('code-craft').allowed).toBe(true);
    expect(edit('/repo/src/site/site.css').allowed).toBe(false);
  });

  it('ignores files neither rule names', () => {
    for (const path of ['/repo/README.md', '/repo/src/site/index.html', '/repo/a.json', '/repo/a.csso', '/repo/a.tsv']) {
      expect(edit(path).allowed, path).toBe(true);
    }
  });
});
