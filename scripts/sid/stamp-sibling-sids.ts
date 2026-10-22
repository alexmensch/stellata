// Stamp frozen Stellata IDs onto clouds.json / local-group.json from the
// committed ledger, after their emitters run. See /scripts/sid/README.md#sibling-artifact-stamping.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { declareOutputs, emitArtifacts } from '../util/emit-artifacts';
import { REPO_ROOT as ROOT } from '../util/paths';
import { resolveSids } from './sid-pure';
import { loadRegistry } from './registry-io';
import {
  SIBLING_ARTIFACTS,
  siblingArtifactObjects,
  type SiblingArtifactSpec,
  type SiblingItem,
} from './sibling-artifacts';

const artifactPath = (spec: SiblingArtifactSpec): string => resolve(ROOT, 'public', spec.file);

const stampOutputs = (specs: readonly SiblingArtifactSpec[]) => declareOutputs(specs.map(artifactPath));

export const SID_STAMP_OUTPUTS = stampOutputs(Object.values(SIBLING_ARTIFACTS));

function stamped(spec: SiblingArtifactSpec): string {
  const path = artifactPath(spec);
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
emitArtifacts({
  outputs: stampOutputs(specs),
  files: new Map(specs.map((spec) => [artifactPath(spec), stamped(spec)])),
});
