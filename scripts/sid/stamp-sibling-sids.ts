// Stamp frozen Stellata IDs onto clouds.json / local-group.json from the
// committed ledger, after their emitters run. See scripts/sid/README.md
// § Sibling-artifact stamping.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT as ROOT } from '../util/paths';
import { resolveSids } from './sid-pure';
import { loadRegistry } from './registry-io';
import {
  SIBLING_ARTIFACTS,
  siblingArtifactObjects,
  type SiblingArtifactSpec,
  type SiblingItem,
} from './sibling-artifacts';

function stamp(spec: SiblingArtifactSpec): void {
  const path = resolve(ROOT, 'public', spec.file);
  if (!existsSync(path)) {
    console.error(`sid:stamp: missing ${path}\n  run ${spec.buildHint} first`);
    process.exit(1);
  }
  const payload = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  const items = payload[spec.arrayKey] as SiblingItem[] | undefined;
  if (!Array.isArray(items)) {
    console.error(`sid:stamp: ${spec.file} has no "${spec.arrayKey}" array`);
    process.exit(1);
  }

  const { ledger, retirements, reinstatements, storedEdges } = loadRegistry();
  const objects = siblingArtifactObjects(spec, items);
  const { objectSids, errors } = resolveSids({
    objects,
    storedEdges,
    ledger,
    retirements,
    reinstatements,
  });
  if (errors.length > 0) {
    console.error(
      `sid:stamp: ${errors.length} ${spec.ns} object(s) failed resolution:\n  ` +
        errors.join('\n  ') +
        `\nA renamed slug needs a bridge in data/sid/sameas-overrides.tsv; a new ` +
        `object needs \`pnpm run sid:allocate\`.`,
    );
    process.exit(1);
  }

  items.forEach((o, i) => {
    (o as { sid?: number }).sid = objectSids[i];
  });
  writeFileSync(path, JSON.stringify(payload) + '\n');
  console.log(`sid:stamp: ${items.length} ${spec.ns} SIDs stamped into ${spec.file}`);
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error(`usage: stamp-sibling-sids.ts <${Object.keys(SIBLING_ARTIFACTS).join('|')}|all> ...`);
  process.exit(1);
}
const specs = targets.includes('all')
  ? Object.values(SIBLING_ARTIFACTS)
  : targets.map((t) => {
      const spec = SIBLING_ARTIFACTS[t];
      if (!spec) {
        console.error(
          `sid:stamp: unknown target "${t}" (expected ${Object.keys(SIBLING_ARTIFACTS).join(', ')})`,
        );
        process.exit(1);
      }
      return spec;
    });
for (const spec of specs) stamp(spec);
