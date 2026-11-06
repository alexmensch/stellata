/**
 * Derives the version each commit in a push range ships from its PR's release level, then tags and publishes it.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import {
  declarationOf,
  extractReleaseNotes,
  planReleases,
  prNumberFromSubject,
  type CommitRelease,
  type PlannedRelease,
  type RangeCommit,
} from './release-plan-pure.ts';
import { releaseAt, releaseCommitAt, releaseOn } from '../util/release-version.ts';

const STEPS = ['plan', 'tag', 'publish'] as const;
type Step = (typeof STEPS)[number];

interface Options {
  step: Step;
  base: string | null;
  head: string;
}

const USAGE = `Usage: cut-releases.ts plan [--head <sha>] | cut-releases.ts <tag|publish> --base <the base plan printed> [--head <sha>]`;

function parseArgs(argv: string[]): Options {
  const [step, ...rest] = argv;
  if (!(STEPS as readonly string[]).includes(step)) throw new Error(USAGE);
  const opts: Options = { step: step as Step, base: null, head: 'HEAD' };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--base') opts.base = rest[++i] ?? null;
    else if (arg === '--head') opts.head = rest[++i] ?? 'HEAD';
    else throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
  }
  // After `tag`, the newest reachable release is one this run made, so only `plan` may derive the base.
  if (opts.step !== 'plan' && opts.base === null) throw new Error(`${opts.step} needs --base\n${USAGE}`);
  return opts;
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function tryRun(command: string, args: string[]): string | null {
  try {
    return run(command, args);
  } catch {
    return null;
  }
}

function prLabels(prNumber: number): string[] {
  return run('gh', ['pr', 'view', String(prNumber), '--json', 'labels', '--jq', '.labels[].name'])
    .split('\n')
    .filter(Boolean);
}

function releaseOf(sha: string, subject: string): CommitRelease {
  const released = releaseOn(sha);
  if (released !== null) return { kind: 'tagged', version: released };
  const prNumber = prNumberFromSubject(subject);
  return prNumber === null ? { kind: 'undeclared' } : declarationOf(prLabels(prNumber));
}

function rangeCommits(base: string, head: string): RangeCommit[] {
  // --first-parent keeps the walk on main's own line.
  const shas = run('git', ['rev-list', '--reverse', '--first-parent', `${base}..${head}`])
    .split('\n')
    .filter(Boolean);
  return shas.map((sha) => {
    const subject = run('git', ['log', '-1', '--pretty=%s', sha]);
    return { sha, subject, release: releaseOf(sha, subject) };
  });
}

function notesFor(release: PlannedRelease): string | null {
  if (release.prNumber === null) return null;
  const body = tryRun('gh', ['pr', 'view', String(release.prNumber), '--json', 'body', '--jq', '.body']);
  if (body === null) return null;
  return extractReleaseNotes(body);
}

function tag(release: PlannedRelease): void {
  if (tryRun('git', ['rev-parse', '-q', '--verify', `refs/tags/${release.tag}`]) !== null) return;
  run('git', ['tag', '-a', release.tag, '-m', release.tag, release.sha]);
}

function publish(release: PlannedRelease, isNewest: boolean): void {
  if (tryRun('gh', ['release', 'view', release.tag]) !== null) {
    console.log(`${release.tag} already released — skipping.`);
    return;
  }
  tag(release);
  run('git', ['push', 'origin', `refs/tags/${release.tag}`]);

  const notes = notesFor(release);
  console.log(`${release.tag} → ${release.sha.slice(0, 7)}, ${notes === null ? 'generated notes' : `notes from PR #${release.prNumber}`}`);
  run('gh', [
    'release', 'create', release.tag,
    '--title', release.tag,
    '--verify-tag',
    `--latest=${isNewest}`,
    ...(notes === null ? ['--generate-notes'] : ['--notes', notes]),
  ]);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const head = run('git', ['rev-parse', opts.head]);
  const base = run('git', ['rev-parse', opts.base ?? releaseCommitAt(head)]);
  const plan = planReleases(releaseAt(base), rangeCommits(base, head));

  console.log(`${plan.length} release(s) from base ${base} to ${head.slice(0, 7)}:`);
  for (const release of plan) console.log(`  ${release.tag} → ${release.sha.slice(0, 7)} (PR #${release.prNumber})`);

  switch (opts.step) {
    case 'plan':
      if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `releases=${plan.length}\nbase=${base}\n`);
      }
      return;
    case 'tag':
      plan.forEach(tag);
      return;
    case 'publish':
      plan.forEach((release, i) => publish(release, i === plan.length - 1));
  }
}

main();
