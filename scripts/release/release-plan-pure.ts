/**
 * Pure release planning: the release level a PR declares, and the version each commit in a push range ships.
 */

import { parseVersion, tagOf } from '../util/release-version.ts';

export type ReleaseLevel = 'major' | 'minor' | 'patch';

export type Declared = { readonly kind: 'release'; readonly level: ReleaseLevel } | { readonly kind: 'none' };

export type Declaration =
  | Declared
  | { readonly kind: 'undeclared' }
  | { readonly kind: 'conflicting'; readonly labels: readonly string[] };

export const SKIP_LABEL = 'skip-version-bump';

export const LEVEL_LABELS: Readonly<Record<string, Declared>> = {
  'release:major': { kind: 'release', level: 'major' },
  'release:minor': { kind: 'release', level: 'minor' },
  'release:patch': { kind: 'release', level: 'patch' },
  [SKIP_LABEL]: { kind: 'none' },
};

export function declarationOf(labels: readonly string[]): Declaration {
  const declaring = [...new Set(labels)].filter((label) => Object.hasOwn(LEVEL_LABELS, label));
  if (declaring.length === 0) return { kind: 'undeclared' };
  if (declaring.length > 1) return { kind: 'conflicting', labels: declaring };
  return LEVEL_LABELS[declaring[0]];
}

/** What a guard tells a PR whose declaration is not exactly one level label. */
export function declarationProblem(declaration: Declaration): string | null {
  const choices = Object.keys(LEVEL_LABELS).join(', ');
  switch (declaration.kind) {
    case 'undeclared': return `no release level declared: attach exactly one of ${choices}`;
    case 'conflicting': return `${declaration.labels.join(' and ')} conflict: keep exactly one of ${choices}`;
    default: return null;
  }
}

export function bumped(version: string, level: ReleaseLevel): string {
  const [major, minor, patch] = parseVersion(version);
  switch (level) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
  }
}

/** A commit already carrying a release tag keeps it, so a rerun over a released range re-derives nothing. */
export type CommitRelease = { readonly kind: 'tagged'; readonly version: string } | Declaration;

export interface RangeCommit {
  sha: string;
  subject: string;
  release: CommitRelease;
}

export interface PlannedRelease {
  sha: string;
  tag: string;
  version: string;
  prNumber: number | null;
}

/** README.md#derived-versions. */
export function planReleases(baseVersion: string, commits: readonly RangeCommit[]): PlannedRelease[] {
  const plan: PlannedRelease[] = [];
  let previous = baseVersion;

  for (const commit of commits) {
    const prNumber = prNumberFromSubject(commit.subject);
    const { release } = commit;
    if (release.kind === 'none') continue;
    if (release.kind === 'undeclared' || release.kind === 'conflicting') {
      const pr = prNumber === null ? 'no PR in its subject' : `PR #${prNumber}`;
      throw new Error(`${commit.sha.slice(0, 7)} (${pr}): ${declarationProblem(release)}`);
    }
    previous = release.kind === 'tagged' ? release.version : bumped(previous, release.level);
    plan.push({ sha: commit.sha, tag: tagOf(previous), version: previous, prNumber });
  }

  return plan;
}

export function prNumberFromSubject(subject: string): number | null {
  const refs = subject.match(/#(\d+)/g);
  if (!refs) return null;
  return Number(refs[refs.length - 1].slice(1));
}

export function extractReleaseNotes(body: string): string | null {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => /^## Release notes[ \t]*\r?$/.test(line));
  if (start === -1) return null;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  const section = (end === -1 ? rest : rest.slice(0, end)).join('\n');

  let stripped = section;
  let previous: string;
  do {
    previous = stripped;
    stripped = stripped.replace(/<!--[\s\S]*?-->/g, '');
  } while (stripped !== previous);

  return /\S/.test(stripped) ? stripped : null;
}
