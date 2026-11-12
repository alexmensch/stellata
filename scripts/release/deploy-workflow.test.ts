import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(resolve(__dirname, '../../.github/workflows/deploy.yml'), 'utf8');

const steps = WORKFLOW.split(/^ {6}- /m).slice(1);

function stepWhere(pattern: RegExp): string {
  const matches = steps.filter((step) => pattern.test(step));
  expect(matches).toHaveLength(1);
  return matches[0];
}

function field(step: string, key: string): string | null {
  return step.match(new RegExp(`^\\s*${key}: (.+)$`, 'm'))?.[1].trim() ?? null;
}

describe('deploy.yml Publish releases token', () => {
  const publish = stepWhere(/^name: Publish releases$/m);
  const token = field(publish, 'GH_TOKEN');

  it('is a GitHub App token minted in this job, never GITHUB_TOKEN', () => {
    expect(token).not.toMatch(/GITHUB_TOKEN|github\.token/);
    expect(token).toMatch(/^\$\{\{ steps\.[\w-]+\.outputs\.token \}\}$/);
  });

  it('carries contents and workflows write, and pull-requests read for the notes', () => {
    const id = token?.match(/steps\.([\w-]+)\.outputs/)?.[1];
    const mint = stepWhere(new RegExp(`^\\s*id: ${id}$`, 'm'));
    expect(field(mint, 'uses')).toMatch(/^actions\/create-github-app-token@/);
    expect(field(mint, 'permission-contents')).toBe('write');
    expect(field(mint, 'permission-workflows')).toBe('write');
    expect(field(mint, 'permission-pull-requests')).toBe('read');
  });

  it('leaves GITHUB_TOKEN read-only, so the App token is the one writer', () => {
    const block = WORKFLOW.match(/^permissions:\n((?: {2}.+\n)+)/m)?.[1] ?? '';
    expect(field(block, 'contents')).toBe('read');
  });
});
