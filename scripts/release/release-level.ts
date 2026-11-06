// The release level a PR's labels declare, one label per stdin line: prints major|minor|patch|none, or fails the guard.

import { readFileSync } from 'node:fs';
import { declarationOf, declarationProblem } from './release-plan-pure.ts';

const labels = readFileSync(0, 'utf8').split('\n').filter(Boolean);
const declaration = declarationOf(labels);
const problem = declarationProblem(declaration);

if (problem !== null) {
  console.error(`::error::${problem}`);
  process.exit(1);
}
console.log(declaration.kind === 'release' ? declaration.level : 'none');
