// Rewrites every marked doc figure from the committed count snapshots.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../util/paths';
import { scanDocFigures } from './doc-figures';

let failed = false;
let rewritten = 0;
for (const { file, text, report } of scanDocFigures(REPO_ROOT)) {
  if (report.problems.length > 0) {
    failed = true;
    for (const p of report.problems) console.error(`${file}: ${p}`);
    continue;
  }
  if (report.rendered !== text) {
    writeFileSync(join(REPO_ROOT, file), report.rendered);
    for (const s of report.stale) console.log(`${file}: ${s}`);
    rewritten++;
  }
}
console.log(`doc figures: ${rewritten} file(s) rewritten`);
if (failed) process.exit(1);
