// Stamp frozen Stellata IDs onto clouds.json / local-group.json from the
// committed ledger, after their emitters run. See scripts/sid/README.md
// § Sibling-artifact stamping.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT as ROOT } from '../util/paths';
import { resolveSids, type SidKind, type SidObject } from './sid-pure';
import { loadRegistry } from './registry-io';

interface ArtifactSpec {
  /** public/ filename. */
  file: string;
  /** Top-level array property holding the objects. */
  arrayKey: string;
  /** Designation namespace the ledger keys these objects on (docs/sid.md § 3). */
  ns: string;
  kind: SidKind;
  buildHint: string;
}

const ARTIFACTS: Record<string, ArtifactSpec> = {
  clouds: {
    file: 'clouds.json',
    arrayKey: 'clouds',
    ns: 'cloud',
    kind: 'cloud',
    buildHint: 'npm run build:clouds',
  },
  'local-group': {
    file: 'local-group.json',
    arrayKey: 'objects',
    ns: 'lg',
    kind: 'galaxy',
    buildHint: 'npm run build:local-group',
  },
};

function stamp(spec: ArtifactSpec): void {
  const path = resolve(ROOT, 'public', spec.file);
  if (!existsSync(path)) {
    console.error(`sid:stamp: missing ${path}\n  run ${spec.buildHint} first`);
    process.exit(1);
  }
  const payload = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  const items = payload[spec.arrayKey] as { id: string; name?: string }[] | undefined;
  if (!Array.isArray(items)) {
    console.error(`sid:stamp: ${spec.file} has no "${spec.arrayKey}" array`);
    process.exit(1);
  }

  const { ledger, retirements, storedEdges } = loadRegistry();
  const objects: SidObject[] = items.map((o) => ({
    designations: [`${spec.ns}:${o.id}`],
    kind: spec.kind,
    label: `${spec.ns} ${o.name ?? o.id}`,
  }));
  const { objectSids, errors } = resolveSids({
    objects,
    storedEdges,
    ledger,
    retirements,
  });
  if (errors.length > 0) {
    console.error(
      `sid:stamp: ${errors.length} ${spec.ns} object(s) failed resolution:\n  ` +
        errors.join('\n  ') +
        `\nA renamed slug needs a bridge in data/sid/sameas-overrides.tsv; a new ` +
        `object needs \`npm run sid:allocate\`.`,
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
  console.error(`usage: stamp-sibling-sids.ts <${Object.keys(ARTIFACTS).join('|')}|all> ...`);
  process.exit(1);
}
const specs = targets.includes('all')
  ? Object.values(ARTIFACTS)
  : targets.map((t) => {
      const spec = ARTIFACTS[t];
      if (!spec) {
        console.error(`sid:stamp: unknown target "${t}" (expected ${Object.keys(ARTIFACTS).join(', ')})`);
        process.exit(1);
      }
      return spec;
    });
for (const spec of specs) stamp(spec);
