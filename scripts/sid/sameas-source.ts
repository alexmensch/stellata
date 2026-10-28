// The stored same-as edges, declared: the curated overrides and every committed bridge.

import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { defineSource, openDeclared, type Declared, type SourceInput } from '../util/sources/source';
import { parseSameasTsv } from './sid-pure';

const OVERRIDES_FROM: Declared = {
  file: 'data/sid/sameas-overrides.tsv',
  hint: 'Same-as edges are curated (/docs/sid.md#41-same-as-equivalence-graph).',
};

export const SAMEAS_OVERRIDES = defineSource({
  ...OVERRIDES_FROM,
  parse: (input) => parseSameasTsv(input.text(), OVERRIDES_FROM),
});

const BRIDGES_DIR = 'data/sid/bridges';
const BRIDGE_HINT = 'Bridges are reviewed and committed per Gaia release (/docs/sid.md#6-gaia-data-release-reconciliation).';

function bridgeFiles(readme: SourceInput): Declared[] {
  return readdirSync(dirname(readme.path))
    .sort()
    .filter((name) => name.endsWith('.tsv'))
    .map((name) => ({ file: `${BRIDGES_DIR}/${name}`, hint: BRIDGE_HINT }));
}

export const SAMEAS_BRIDGES = defineSource({
  file: `${BRIDGES_DIR}/README.md`,
  hint: BRIDGE_HINT,
  members: bridgeFiles,
  parse: (readme) => bridgeFiles(readme).flatMap((bridge) => parseSameasTsv(openDeclared(bridge).text(), bridge)),
});
