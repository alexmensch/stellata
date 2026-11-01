// `pnpm run sid:stamp`. See /scripts/sid/README.md#sibling-artifact-stamping.

import { existsSync, readFileSync } from 'node:fs';

import { emitArtifacts, runStep } from '../util/emit-artifacts';
import { packageVersion } from '../util/git-provenance';
import { allocate, type Upstream } from './allocate-pure';
import type { EventRow } from './events-pure';
import { loadRegistry, registryTexts } from './registry-io';
import type { LedgerRow } from './sid-pure';
import {
  SIBLING_ARTIFACTS,
  siblingArtifactObjects,
  type SiblingItem,
} from './sibling-artifacts';
import { SID_STAMP_OUTPUTS } from './sibling-stamp-outputs';

const NO_LINEAGE: Upstream = { causes: () => new Map(), admissions: () => new Map() };

function main(): void {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    throw new Error(`usage: stamp-sibling-sids.ts <${Object.keys(SIBLING_ARTIFACTS).join('|')}|all> ...`);
  }
  const names = targets.includes('all') ? Object.keys(SIBLING_ARTIFACTS) : targets;
  for (const t of names) {
    if (!SIBLING_ARTIFACTS[t]) {
      throw new Error(`sid:stamp: unknown target "${t}" (expected ${Object.keys(SIBLING_ARTIFACTS).join(', ')})`);
    }
  }

  const registry = loadRegistry();
  const minted: LedgerRow[] = [];
  const events: EventRow[] = [];
  const stamped: Record<string, string> = {};
  for (const name of names) {
    const spec = SIBLING_ARTIFACTS[name];
    const path = SID_STAMP_OUTPUTS.files[name];
    if (!existsSync(path)) throw new Error(`sid:stamp: missing ${path}\n  run ${spec.buildHint} first`);
    const payload = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const items = payload[spec.arrayKey] as SiblingItem[] | undefined;
    if (!Array.isArray(items)) throw new Error(`sid:stamp: ${spec.file} has no "${spec.arrayKey}" array`);

    const allocation = allocate({
      objects: siblingArtifactObjects(spec, items),
      storedEdges: registry.storedEdges,
      ledger: [...registry.ledger, ...minted],
      events: [...registry.events, ...events],
      scope: (ns) => ns === spec.ns,
      date: new Date().toISOString().slice(0, 10),
      version: packageVersion(),
    }, NO_LINEAGE);
    if (allocation.kind === 'failed') {
      throw new Error(
        `sid:stamp: ${spec.ns} allocation failed:\n  ${allocation.errors.join('\n  ')}\n`
          + 'A renamed slug needs a bridge in data/sid/sameas-overrides.tsv.',
      );
    }
    minted.push(...allocation.minted);
    events.push(...allocation.events);
    items.forEach((o, i) => { (o as { sid?: number }).sid = allocation.objectSids[i]; });
    console.log(`sid:stamp: ${items.length} ${spec.ns} SIDs stamped into ${spec.file} (${allocation.minted.length} minted)`);
    stamped[name] = `${JSON.stringify(payload)}\n`;
  }

  emitArtifacts({
    outputs: SID_STAMP_OUTPUTS,
    only: [...names, 'sidLedger', 'sidEvents', 'sidHead'],
    files: { ...stamped, ...registryTexts(minted, events) },
  });
}

runStep(main);
