import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(resolve(__dirname, '../../.github/workflows/deploy.yml'), 'utf8');

const jobs = WORKFLOW.slice(WORKFLOW.search(/^jobs:$/m)).split(/^ {2}(?=[\w-]+:$)/m).slice(1);

function stepsOf(text: string): string[] {
  return text.split(/^ {6}- /m).slice(1);
}

function only<T>(matches: T[]): T {
  expect(matches).toHaveLength(1);
  return matches[0];
}

function stepWhere(pattern: RegExp): string {
  return only(stepsOf(WORKFLOW).filter((step) => pattern.test(step)));
}

function field(step: string, key: string): string | null {
  return step.match(new RegExp(`^\\s*${key}: (.+)$`, 'm'))?.[1].trim() ?? null;
}

const PUBLISH = /^name: Publish releases$/m;

function publishToken(): string | null {
  return field(stepWhere(PUBLISH), 'GH_TOKEN');
}

function mintStep(): string {
  const id = publishToken()?.match(/steps\.([\w-]+)\.outputs/)?.[1];
  return stepWhere(new RegExp(`^\\s*id: ${id}$`, 'm'));
}

function publishJob(): string {
  return only(jobs.filter((job) => stepsOf(job).some((step) => PUBLISH.test(step))));
}

describe('deploy.yml Publish releases token', () => {
  it('is a GitHub App token minted in the same job, never GITHUB_TOKEN', () => {
    const token = publishToken();
    expect(token).not.toMatch(/GITHUB_TOKEN|github\.token/);
    expect(token).toMatch(/^\$\{\{ steps\.[\w-]+\.outputs\.token \}\}$/);
    expect(stepsOf(publishJob())).toContain(mintStep());
  });

  it('carries contents and workflows write, and pull-requests read for the notes', () => {
    const mint = mintStep();
    expect(field(mint, 'permission-contents')).toBe('write');
    expect(field(mint, 'permission-workflows')).toBe('write');
    expect(field(mint, 'permission-pull-requests')).toBe('read');
  });

  it('mints with create-github-app-token pinned to a commit, since the step holds the App key', () => {
    expect(field(mintStep(), 'uses')).toMatch(/^actions\/create-github-app-token@[0-9a-f]{40}(\s|$)/);
  });

  it('leaves GITHUB_TOKEN read-only, so the App token is the one writer', () => {
    const block = WORKFLOW.match(/^permissions:\n((?: {2}.+\n)+)/m)?.[1] ?? '';
    expect(field(block, 'contents')).toBe('read');
  });
});

describe('deploy.yml publish job', () => {
  it('runs after the deploy job, so a failed deploy publishes nothing', () => {
    expect(field(publishJob(), 'needs')).toMatch(/\bdeploy\b/);
  });

  it('installs nothing, so no dependency code shares a runner with the App key', () => {
    const job = publishJob();
    expect(job).not.toMatch(/\b(?:pnpm|npm|npx|yarn|pip)\b/);
    const actions = stepsOf(job).map((step) => field(step, 'uses')?.split('@')[0]).filter(Boolean);
    expect(actions).toEqual(['actions/checkout', 'actions/setup-node', 'actions/create-github-app-token']);
  });

  it('checks out only the dependency-free release scripts, without persisting credentials', () => {
    const checkout = only(stepsOf(publishJob()).filter((step) => field(step, 'uses')?.startsWith('actions/checkout@')));
    expect(field(checkout, 'persist-credentials')).toBe('false');
    const paths = checkout.match(/sparse-checkout: \|\n((?: {12}.+\n)+)/)?.[1].trim().split(/\s+/);
    expect(paths).toEqual(['scripts/release', 'scripts/util']);
  });
});
