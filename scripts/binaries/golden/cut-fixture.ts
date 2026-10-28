// Re-cut the golden's fixtures from the real multiples.tsv and a built row-index map. See README.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DEFAULT_ROW_INDEX_MAP } from '../../catalog/catalog-lookup';
import { MULTIPLES_TSV } from '../multiples-tsv';
import { readArtifact } from '../../util/sources/source';
import { REPO_ROOT } from '../../util/paths';
import { FIXTURE_SYSTEMS, cutMultiples, cutRowIndexMap } from './cut-fixture-pure';

const HERE = resolve(REPO_ROOT, 'scripts/binaries/golden');

const multiples = cutMultiples(
  readArtifact(MULTIPLES_TSV), FIXTURE_SYSTEMS,
);
const map = cutRowIndexMap(
  JSON.parse(readFileSync(DEFAULT_ROW_INDEX_MAP, 'utf8')), multiples, FIXTURE_SYSTEMS,
);
writeFileSync(resolve(HERE, 'fixture-multiples.tsv'), MULTIPLES_TSV.serialize(multiples));
writeFileSync(resolve(HERE, 'fixture-row-index-map.json'), `${JSON.stringify(map, null, 1)}\n`);
console.log(`cut ${FIXTURE_SYSTEMS.length} systems`);
