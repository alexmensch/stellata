// Every .worktreeinclude pattern is an output, or a stamp, of a step build:seed runs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CATALOG_OUTPUTS, CATALOG_STAMP } from './catalog/catalog-outputs';
import { MEMBERSHIP_OUTPUTS } from './catalog/membership/membership-manifest-outputs';
import type { DeclaredOutputs, OutputFamily } from './util/emit-artifacts';
import { escapeRegExp } from './util/escape-regexp';
import { packageScripts } from './util/import-closure';
import { scriptParts } from './util/import-closure-pure';
import { REPO_ROOT } from './util/paths';

interface StepOutputs {
  readonly files: readonly string[];
  readonly families: readonly OutputFamily[];
}

const TS_STEPS: Readonly<Record<string, { outputs: DeclaredOutputs; stamp?: string }>> = {
  'build:catalog': { outputs: CATALOG_OUTPUTS, stamp: CATALOG_STAMP },
  'build:membership': { outputs: MEMBERSHIP_OUTPUTS },
};

const rel = (path: string): string => relative(REPO_ROOT, path);
const scripts = packageScripts();

function pythonOutputs(text: string): { outputs: string[]; stamp: string } {
  const answer: unknown = JSON.parse(text);
  if (typeof answer === 'object' && answer !== null && 'outputs' in answer && 'stamp' in answer) {
    const { outputs, stamp } = answer;
    if (Array.isArray(outputs) && outputs.every((o) => typeof o === 'string') && typeof stamp === 'string') {
      return { outputs, stamp };
    }
  }
  throw new Error(`malformed --outputs answer: ${text}`);
}

function stepOutputs(step: string): StepOutputs {
  const [part, ...rest] = scriptParts(scripts, step);
  if (rest.length > 0) throw new Error(`${step} is not one command`);
  if (part.kind === 'python') {
    const { outputs, stamp } = pythonOutputs(execFileSync('python3', [part.entry, '--outputs'], { cwd: REPO_ROOT, encoding: 'utf8' }));
    return { files: [...outputs, stamp], families: [] };
  }
  const declared = TS_STEPS[step];
  if (part.kind !== 'tsx' || declared === undefined) throw new Error(`no output declaration for seed step ${step}`);
  const { outputs, stamp } = declared;
  return {
    files: [...Object.values<string>(outputs.files), ...(stamp === undefined ? [] : [stamp])].map(rel),
    families: outputs.families.map((f) => ({ dir: rel(f.dir), member: f.member })),
  };
}

function globRegExp(pattern: string): RegExp {
  return new RegExp(`^${pattern.split('*').map(escapeRegExp).join('[^/]*')}$`);
}

function covers(outputs: StepOutputs, pattern: string): boolean {
  const glob = globRegExp(pattern);
  return outputs.files.some((file) => glob.test(file))
    || outputs.families.some((f) => f.dir === dirname(pattern) && f.member.test(basename(pattern).replaceAll('*', '0')));
}

function uncovered(patterns: readonly string[], steps: readonly string[]): string[] {
  const outputs = steps.map(stepOutputs);
  return patterns.filter((pattern) => !outputs.some((o) => covers(o, pattern)));
}

function unlisted(patterns: readonly string[], steps: readonly string[]): string[] {
  const globs = patterns.map(globRegExp);
  return steps.flatMap((step) => stepOutputs(step).files)
    .filter((file) => /^(public|build)\//.test(file) && !globs.some((glob) => glob.test(file)));
}

function stepsOf(target: string): string[] {
  const parts = scriptParts(scripts, target);
  if (!parts.every((part) => part.kind === 'pnpm')) return [target];
  return [...new Set(parts.flatMap((part) => stepsOf(part.script)))];
}

const SEED_STEPS = stepsOf('build:seed-steps');

const PATTERNS = readFileSync(resolve(REPO_ROOT, '.worktreeinclude'), 'utf8')
  .split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));

describe('.worktreeinclude', () => {
  it('lists only outputs and stamps of the steps build:seed runs', () => {
    expect(uncovered(PATTERNS, SEED_STEPS)).toEqual([]);
  }, 60_000);

  it('lists every gitignored output file and stamp of those steps', () => {
    expect(unlisted(PATTERNS, SEED_STEPS)).toEqual([]);
  }, 60_000);

  it('loses the lineage baseline without build:membership', () => {
    expect(uncovered(PATTERNS, SEED_STEPS.filter((step) => step !== 'build:membership'))).toEqual(['build/lineage/*']);
  }, 60_000);
});
