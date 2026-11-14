/**
 * Derives the version each commit in a push range ships from its PR's release level, then tags and publishes it.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import {
  declarationOf,
  extractReleaseNotes,
  parsePlan,
  planReleases,
  prNumberFromSubject,
  type CommitRelease,
  type PlannedRelease,
  type RangeCommit,
} from './release-plan-pure.ts';
import { releaseAt, releaseCommitAt, releaseOn } from '../util/release-version.ts';

type PlanSource = { readonly from: 'file'; readonly path: string } | { readonly from: 'env' };

type Options =
  | { readonly step: 'plan'; readonly head: string; readonly out: string | null }
  | { readonly step: 'tag' | 'publish'; readonly plan: PlanSource };

const USAGE =
  'Usage: cut-releases.ts plan [--head <sha>] [--out <plan.json>] | cut-releases.ts <tag|publish> [--plan <plan.json>] (else the PLAN env var)';

function parseArgs(argv: string[]): Options {
  const [step, ...rest] = argv;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1];
    if (!['--head', '--out', '--plan'].includes(rest[i]) || value === undefined) {
      throw new Error(`Bad argument: ${rest[i]}\n${USAGE}`);
    }
    flags.set(rest[i], value);
  }
  if (step === 'plan' && !flags.has('--plan')) {
    return { step, head: flags.get('--head') ?? 'HEAD', out: flags.get('--out') ?? null };
  }
  const plan = flags.get('--plan');
  if ((step === 'tag' || step === 'publish') && flags.size === (plan === undefined ? 0 : 1)) {
    return { step, plan: plan === undefined ? { from: 'env' } : { from: 'file', path: plan } };
  }
  throw new Error(USAGE);
}

function readPlan(source: PlanSource): string {
  if (source.from === 'file') return readFileSync(source.path, 'utf8');
  const plan = process.env.PLAN;
  if (plan === undefined || plan === '') throw new Error(`No plan: PLAN is unset and no --plan given.\n${USAGE}`);
  return plan;
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
  const notes = notesFor(release);
  console.log(`${release.tag} → ${release.sha.slice(0, 7)}, ${notes === null ? 'generated notes' : `notes from PR #${release.prNumber}`}`);
  // GitHub makes the tag with the release, so origin never holds a release tag without its page.
  run('gh', [
    'release', 'create', release.tag,
    '--target', release.sha,
    '--title', release.tag,
    `--latest=${isNewest}`,
    ...(notes === null ? ['--generate-notes'] : ['--notes', notes]),
  ]);
}

function plan(head: string): PlannedRelease[] {
  const headSha = run('git', ['rev-parse', head]);
  const base = releaseCommitAt(headSha);
  const releases = planReleases(releaseAt(base), rangeCommits(base, headSha));
  console.log(`${releases.length} release(s) from base ${base} to ${headSha.slice(0, 7)}:`);
  for (const release of releases) console.log(`  ${release.tag} → ${release.sha.slice(0, 7)} (PR #${release.prNumber})`);
  return releases;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.step === 'plan') {
    const releases = plan(opts.head);
    const json = JSON.stringify(releases);
    if (opts.out !== null) writeFileSync(opts.out, `${json}\n`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `releases=${releases.length}\nplan=${json}\n`);
    return;
  }
  const releases = parsePlan(readPlan(opts.plan));
  if (opts.step === 'tag') releases.forEach(tag);
  else releases.forEach((release, i) => publish(release, i === releases.length - 1));
}

main();
