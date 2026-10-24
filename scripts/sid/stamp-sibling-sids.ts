// Stamp frozen Stellata IDs onto clouds.json / local-group.json from the
// committed ledger, after their emitters run. See /scripts/sid/README.md#sibling-artifact-stamping.

import { existsSync, readFileSync } from 'node:fs';

import { emitArtifacts, runStep } from '../util/emit-artifacts';
import { resolveSids } from './sid-pure';
import { loadRegistry } from './registry-io';
import {
  SIBLING_ARTIFACTS,
  siblingArtifactObjects,
  type SiblingItem,
} from './sibling-artifacts';
import { SID_STAMP_OUTPUTS } from './sibling-stamp-outputs';


function stamped(name: string): string {
  const spec = SIBLING_ARTIFACTS[name];
  const path = SID_STAMP_OUTPUTS.files[name];
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
  console.log(`sid:stamp: ${items.length} ${spec.ns} SIDs stamped into ${spec.file}`);
  return JSON.stringify(payload) + '\n';
}

function main(): void {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error(`usage: stamp-sibling-sids.ts <${Object.keys(SIBLING_ARTIFACTS).join('|')}|all> ...`);
    process.exit(1);
  }
  const names = targets.includes('all') ? Object.keys(SIBLING_ARTIFACTS) : targets;
  for (const t of names) {
    if (!SIBLING_ARTIFACTS[t]) {
      console.error(
        `sid:stamp: unknown target "${t}" (expected ${Object.keys(SIBLING_ARTIFACTS).join(', ')})`,
      );
      process.exit(1);
    }
  }
  emitArtifacts({
    outputs: SID_STAMP_OUTPUTS,
    only: names,
    files: Object.fromEntries(names.map((n) => [n, stamped(n)])),
  });
}

runStep(main);
