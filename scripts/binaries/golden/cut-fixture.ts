// Re-cut the golden's fixtures from the real multiples.tsv and a built row-index map. See README.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MULTIPLES_TSV } from '../multiples-tsv';
import { readArtifact } from '../../util/sources/source';
import { REPO_ROOT } from '../../util/paths';
import { hashBytes } from '../../util/stamp-hash';
import { FIXTURE_SYSTEMS, cutMultiples, cutRowIndexMap } from './cut-fixture-pure';
import { BUILD_FILES } from '../../../src/catalog-format/pipeline-outputs/build-files';

const HERE = resolve(REPO_ROOT, 'scripts/binaries/golden');

const multiples = cutMultiples(
  readArtifact(MULTIPLES_TSV), FIXTURE_SYSTEMS,
);
const multiplesTsv = MULTIPLES_TSV.serialize(multiples);
const map = cutRowIndexMap(
  JSON.parse(readFileSync(resolve(REPO_ROOT, BUILD_FILES.catalogRowIndexMap), 'utf8')), multiples, FIXTURE_SYSTEMS,
  hashBytes(multiplesTsv),
);
writeFileSync(resolve(HERE, 'fixture-multiples.tsv'), multiplesTsv);
writeFileSync(resolve(HERE, 'fixture-row-index-map.json'), `${JSON.stringify(map, null, 1)}\n`);
console.log(`cut ${FIXTURE_SYSTEMS.length} systems`);
