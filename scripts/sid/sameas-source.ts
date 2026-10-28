// The stored same-as edges, declared: the curated overrides and every committed bridge.

import { defineFolder, defineSource } from '../util/sources/source';
import { parseSameasTsv } from './sid-pure';

export const SAMEAS_OVERRIDES = defineSource({
  file: 'data/sid/sameas-overrides.tsv',
  hint: 'Same-as edges are curated (/docs/sid.md#41-same-as-equivalence-graph).',
  parse: (input) => parseSameasTsv(input.text(), input),
});

export const SAMEAS_BRIDGES = defineFolder({
  dir: 'data/sid/bridges',
  hint: 'Bridges are reviewed and committed per Gaia release (/docs/sid.md#6-gaia-data-release-reconciliation).',
  include: (name) => name.endsWith('.tsv'),
  parse: (folder) => folder.members.flatMap((bridge) => parseSameasTsv(bridge.text(), bridge)),
});
