// Rewrites every marked doc figure from the committed count snapshots.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../util/paths';
import { docFiles, loadSnapshots } from './doc-figures';
import { renderFigures } from './doc-figures-pure';

const snapshots = loadSnapshots(REPO_ROOT);
let failed = false;
let rewritten = 0;
for (const file of docFiles(REPO_ROOT)) {
  const path = join(REPO_ROOT, file);
  const text = readFileSync(path, 'utf8');
  const report = renderFigures(text, snapshots);
  if (report.problems.length > 0) {
    failed = true;
    for (const p of report.problems) console.error(`${file}: ${p}`);
    continue;
  }
  if (report.rendered !== text) {
    writeFileSync(path, report.rendered);
    for (const s of report.stale) console.log(`${file}: ${s}`);
    rewritten++;
  }
}
console.log(`doc figures: ${rewritten} file(s) rewritten`);
if (failed) process.exit(1);
