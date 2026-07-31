/**
 * Pure release planning: which commits in a push range carry a version bump.
 */

export interface RangeCommit {
  sha: string;
  subject: string;
  version: string;
}

export interface PlannedRelease {
  sha: string;
  tag: string;
  version: string;
  prNumber: number | null;
}

/**
 * Walks a push range oldest-first and emits one release per version
 * change. A push landing N stacked merges therefore yields N releases.
 */
export function planReleases(baseVersion: string, commits: RangeCommit[]): PlannedRelease[] {
  const byTag = new Map<string, PlannedRelease>();
  let previous = baseVersion;

  for (const commit of commits) {
    if (commit.version === previous) continue;
    previous = commit.version;

    const tag = `v${commit.version}`;
    // A version reverted and re-reached inside one range would otherwise
    // plan the same tag twice, which fails on the second push.
    byTag.delete(tag);
    byTag.set(tag, {
      sha: commit.sha,
      tag,
      version: commit.version,
      prNumber: prNumberFromSubject(commit.subject),
    });
  }

  return [...byTag.values()];
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
