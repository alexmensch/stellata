// see /scripts/release/README.md (release-notes-check.ts)

import { readFileSync } from 'node:fs';
import { extractReleaseNotes } from './release-plan-pure.ts';

const body = readFileSync(process.argv[2], 'utf8');

if (!/\S/.test(body)) {
  console.log("::error::PR body is empty. Use the PR template — the '## Release notes' section is required.");
  process.exit(1);
}

if (extractReleaseNotes(body) === null) {
  console.log("::error::PR body must include a non-empty '## Release notes' section (HTML comments don't count). Add bullets describing user-visible changes — they will appear on the GitHub release page for this version. Or attach the 'skip-version-bump' label for metadata-only PRs.");
  process.exit(1);
}

console.log('Release notes section present and non-empty.');
