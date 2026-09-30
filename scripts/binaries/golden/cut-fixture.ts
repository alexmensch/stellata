// Re-cut the golden's fixtures from the real multiples.tsv and a built row-index map. See README.md.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DEFAULT_ROW_INDEX_MAP } from '../../catalog/catalog-lookup';
import { MULTIPLES_TSV } from '../../catalog/companions/companion-promotion';
import { REPO_ROOT, readRequired } from '../../util/paths';
import { FIXTURE_SYSTEMS, cutMultiples, cutRowIndexMap } from './cut-fixture-pure';

const HERE = resolve(REPO_ROOT, 'scripts/binaries/golden');

const multiples = cutMultiples(
  readRequired(MULTIPLES_TSV, 'pnpm run build:binaries'), FIXTURE_SYSTEMS,
);
const map = cutRowIndexMap(
  JSON.parse(readRequired(DEFAULT_ROW_INDEX_MAP, 'pnpm run build:catalog')), multiples, FIXTURE_SYSTEMS,
);
writeFileSync(resolve(HERE, 'fixture-multiples.tsv'), multiples);
writeFileSync(resolve(HERE, 'fixture-row-index-map.json'), `${JSON.stringify(map, null, 1)}\n`);
console.log(`cut ${FIXTURE_SYSTEMS.length} systems`);
