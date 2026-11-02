// `pnpm run sid:stamp`. See /scripts/sid/README.md#sibling-artifact-stamping.

import { existsSync, readFileSync } from 'node:fs';

import { emitArtifacts, runStep } from '../util/emit-artifacts';
import { allocateSibling, siblingEmission } from './sibling-allocation';
import { SIBLING_ARTIFACTS, type SiblingItem } from './sibling-artifacts';
import { SID_STAMP_OUTPUTS } from './sibling-stamp-outputs';

function main(): void {
  const spec = SIBLING_ARTIFACTS.clouds;
  const path = SID_STAMP_OUTPUTS.files.clouds;
  if (!existsSync(path)) throw new Error(`sid:stamp: missing ${path}\n  run ${spec.buildHint} first`);
  const payload = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  const items = payload[spec.arrayKey] as SiblingItem[] | undefined;
  if (!Array.isArray(items)) throw new Error(`sid:stamp: ${spec.file} has no "${spec.arrayKey}" array`);

  const allocation = allocateSibling(spec, items);
  items.forEach((o, i) => { (o as { sid?: number }).sid = allocation.sids[i]; });
  console.log(`sid:stamp: ${items.length} ${spec.ns} SIDs stamped into ${spec.file} (${allocation.minted} minted)`);

  emitArtifacts({ outputs: SID_STAMP_OUTPUTS, ...siblingEmission({ clouds: `${JSON.stringify(payload)}\n` }, allocation) });
}

runStep(main);
