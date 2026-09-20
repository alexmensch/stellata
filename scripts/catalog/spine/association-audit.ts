// `pnpm run audit:spine-associations` — which spine rows carry an identifier
// association only AT-HYG makes. Prints the report; --out=<dir> also writes
// the rows behind it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT as ROOT, readRequired } from '../../util/paths';
import {
  LINK_CLASSES, auditAssociations, formatAssociationReport, linkTablesFrom,
} from './association-audit-pure';
import { INHERITED_SPINE_FILE, parseSpineTsv } from './inherited-spine-pure';
import { LFS_HINT, loadPrimaryTables } from './primaries-tables';

const ID_COLS = ['tyc', 'hip', 'hd', 'hr', 'gl', 'flam', 'bayer', 'proper', 'gaia_source_id'] as const;

async function main(): Promise<void> {
  const outDir = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? null;
  const spine = parseSpineTsv(readRequired(resolve(ROOT, INHERITED_SPINE_FILE), LFS_HINT));
  const tables = await loadPrimaryTables(spine.map((r) => r.tyc).filter((t) => t !== ''));
  const links = linkTablesFrom(tables);
  const audit = auditAssociations(spine, links);
  console.log(formatAssociationReport(audit.summary));

  if (outDir === null) return;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(audit.summary, null, 2) + '\n');
  const header = [...ID_COLS, ...LINK_CLASSES.map((c) => `partition_${c}`)];
  const lines = audit.disconnected.map(({ row, partition }) => [
    ...ID_COLS.map((c) => row[c]), ...LINK_CLASSES.map((c) => partition.partition[c]),
  ].join('\t'));
  writeFileSync(resolve(outDir, 'disconnected.tsv'), `${[header.join('\t'), ...lines].join('\n')}\n`);
  console.log(`wrote ${outDir}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
