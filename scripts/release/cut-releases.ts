/**
 * Tags and publishes a GitHub release for every version bump in a push range.
 */

import { execFileSync } from 'node:child_process';
import { planReleases, extractReleaseNotes, type RangeCommit, type PlannedRelease } from './release-plan-pure';

interface Options {
  base: string;
  head: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { base: '', head: 'HEAD', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base') opts.base = argv[++i] ?? '';
    else if (arg === '--head') opts.head = argv[++i] ?? 'HEAD';
    else if (arg === '--dry-run') opts.dryRun = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      console.error('Usage: cut-releases.ts [--base <sha>] [--head <sha>] [--dry-run]');
      process.exit(1);
    }
  }
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

function versionAt(ref: string): string {
  return JSON.parse(run('git', ['show', `${ref}:package.json`])).version;
}

function commitExists(ref: string): boolean {
  return tryRun('git', ['cat-file', '-e', `${ref}^{commit}`]) !== null;
}

function rangeCommits(base: string, head: string): RangeCommit[] {
  // --first-parent keeps the walk on main's own line, so a merged
  // branch's internal commits never each look like a version change.
  const shas = run('git', ['rev-list', '--reverse', '--first-parent', `${base}..${head}`])
    .split('\n')
    .filter(Boolean);
  return shas.map((sha) => ({
    sha,
    subject: run('git', ['log', '-1', '--pretty=%s', sha]),
    version: versionAt(sha),
  }));
}

function notesFor(release: PlannedRelease): string | null {
  if (release.prNumber === null) return null;
  const body = tryRun('gh', ['pr', 'view', String(release.prNumber), '--json', 'body', '--jq', '.body']);
  if (body === null) return null;
  return extractReleaseNotes(body);
}

function cut(release: PlannedRelease, isNewest: boolean, dryRun: boolean): void {
  if (tryRun('gh', ['release', 'view', release.tag]) !== null) {
    console.log(`${release.tag} already released — skipping.`);
    return;
  }

  const notes = notesFor(release);
  const source = notes === null
    ? 'generated notes (no usable "## Release notes" section)'
    : `notes from PR #${release.prNumber}`;
  console.log(`${release.tag} → ${release.sha.slice(0, 7)}, ${source}`);
  if (dryRun) return;

  if (!tryRun('git', ['rev-parse', '-q', '--verify', `refs/tags/${release.tag}`])) {
    run('git', ['tag', '-a', release.tag, '-m', release.tag, release.sha]);
    run('git', ['push', 'origin', release.tag]);
  }

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

  // No usable base (first push, or a force-push whose `before` is gone):
  // fall back to the single-commit comparison this replaced.
  const base = opts.base && commitExists(opts.base) ? opts.base : `${head}^`;
  if (!commitExists(base)) {
    console.log('No parent commit to compare against — nothing to release.');
    return;
  }

  const plan = planReleases(versionAt(base), rangeCommits(base, head));
  if (plan.length === 0) {
    console.log('No version change in the pushed range — nothing to release.');
    return;
  }

  console.log(`${plan.length} release(s) to cut from ${base.slice(0, 7)}..${head.slice(0, 7)}:`);
  plan.forEach((release, i) => cut(release, i === plan.length - 1, opts.dryRun));
}

main();
