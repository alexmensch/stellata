// `pnpm run sid:allocate` — the only writer of data/sid/ledger.tsv: resolves
// every built-artifact object against the frozen ledger and appends mints.
// `pnpm run sid:check` (--check): read-only CI mode — docs/sid.md § 4.5.

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DEFAULT_ROW_INDEX_MAP,
  DEFAULT_SEARCH_INDEX,
  loadCatalog,
} from '../catalog/catalog-lookup';
import { FLAG_IS_SOL, type SearchEntry } from '../catalog/catalog-pure';
import { catalogRecordDesignations } from './catalog-designations';
import { REPO_ROOT as ROOT } from '../util/paths';
import {
  LEDGER_HEADER,
  REINSTATEMENTS_HEADER,
  RETIREMENTS_HEADER,
  allocate,
  computeLedgerHead,
  parseDesignation,
  parseLedgerTsv,
  parseReinstatementsTsv,
  parseRetirementsTsv,
  parseSolObjectsTsv,
  parseShellObjectsTsv,
  serializeLedgerRow,
  validateLedger,
  validateReinstatements,
  validateRetirements,
  type SidObject,
} from './sid-pure';
import {
  HEAD_PATH, LEDGER_PATH, REINSTATEMENTS_PATH, RETIREMENTS_PATH,
  SOL_OBJECTS_PATH, SHELL_OBJECTS_PATH, loadStoredEdges,
} from './registry-io';
import { SIBLING_ARTIFACTS, siblingArtifactObjects, type SiblingItem } from './sibling-artifacts';

const PUBLIC_DIR = resolve(ROOT, 'public');
const MULTIPLES_PATH = resolve(ROOT, 'data/binaries/multiples.tsv');

function requireFile(path: string, hint: string): string {
  if (!existsSync(path)) {
    console.error(`sid:allocate: missing ${path}\n  ${hint}`);
    process.exit(1);
  }
  return readFileSync(path, 'utf-8');
}

async function collectObjects(): Promise<{ objects: SidObject[]; starCount: number }> {
  const catalog = await loadCatalog();
  const searchIndex = JSON.parse(
    requireFile(DEFAULT_SEARCH_INDEX, 'run pnpm run build:catalog'),
  ) as SearchEntry[];
  const rowIndexMap = JSON.parse(
    requireFile(DEFAULT_ROW_INDEX_MAP, 'run pnpm run build:catalog'),
  ) as { bySynth: Record<string, number> };

  const objects: SidObject[] = [];
  let solRecords = 0;
  for (const r of catalogRecordDesignations(catalog, searchIndex, rowIndexMap.bySynth)) {
    if (r.flags & FLAG_IS_SOL) solRecords++;
    objects.push({
      designations: r.designations,
      kind: 'star',
      label: `record ${r.i}${r.name ? ` (${r.name})` : ''}`,
    });
  }
  if (solRecords !== 1) {
    console.error(`sid:allocate: expected exactly 1 FLAG_IS_SOL record, found ${solRecords}`);
    process.exit(1);
  }
  const starCount = objects.length;

  for (const spec of Object.values(SIBLING_ARTIFACTS)) {
    const payload = JSON.parse(
      requireFile(resolve(PUBLIC_DIR, spec.file), `run ${spec.buildHint}`),
    ) as Record<string, SiblingItem[]>;
    objects.push(...siblingArtifactObjects(spec, payload[spec.arrayKey]));
  }

  const solRows = parseSolObjectsTsv(requireFile(SOL_OBJECTS_PATH, 'committed under data/sid/'));
  const sun = solRows.find((r) => r.key === 'sun');
  if (!sun || sun.kind !== 'star') {
    console.error(`sid:allocate: sol-objects.tsv must carry "sun" with kind star`);
    process.exit(1);
  }
  for (const row of solRows) {
    // sol:sun rides the FLAG_IS_SOL catalog record — the same-as edge of
    // docs/sid.md § 7 — so it must not surface as a second object here.
    if (row.key === 'sun') continue;
    objects.push({ designations: [`sol:${row.key}`], kind: row.kind, label: `sol ${row.key}` });
  }

  const shellRows = parseShellObjectsTsv(
    requireFile(SHELL_OBJECTS_PATH, 'committed under data/sid/'),
  );
  for (const row of shellRows) {
    objects.push({ designations: [`shell:${row.key}`], kind: row.kind, label: `shell ${row.key}` });
  }

  return { objects, starCount };
}

function synthChurnReport(orphanKeys: string[], currentSynthKeys: string[]): string {
  interface PairRow {
    comp: string;
    sep: string;
    pa: string;
  }
  const rowsByWds = new Map<string, PairRow[]>();
  if (existsSync(MULTIPLES_PATH)) {
    const lines = readFileSync(MULTIPLES_PATH, 'utf-8').trimEnd().split('\n');
    const cols = lines[0].split('\t');
    const col = (name: string) => cols.indexOf(name);
    const [iSys, iComp, iSep, iPa] = [col('system_id'), col('comp'), col('sep_arcsec'), col('pa_deg')];
    for (const line of lines.slice(1)) {
      const cells = line.split('\t');
      const list = rowsByWds.get(cells[iSys]);
      const row = { comp: cells[iComp], sep: cells[iSep], pa: cells[iPa] };
      if (list) list.push(row);
      else rowsByWds.set(cells[iSys], [row]);
    }
  }
  const lines: string[] = [];
  for (const key of orphanKeys) {
    const wdsRoot = key.slice(0, key.lastIndexOf('-'));
    lines.push(`  synth:${key} — no current synth key matches (WDS root ${wdsRoot})`);
    const siblings = currentSynthKeys.filter((k) => k.startsWith(`${wdsRoot}-`));
    for (const sib of siblings) {
      const comp = sib.slice(wdsRoot.length + 1);
      const pair = (rowsByWds.get(wdsRoot) ?? []).find((r) => r.comp === comp);
      lines.push(
        `    candidate synth:${sib}` +
          (pair ? ` (comp ${pair.comp}, sep ${pair.sep}", PA ${pair.pa}°)` : ''),
      );
    }
    if (siblings.length === 0) lines.push('    (no current synth keys under this WDS root)');
  }
  lines.push(
    '  Resolve each by hand (docs/sid.md § 5): a bridge line in',
    '  data/sid/sameas-overrides.tsv for a re-lettered component, or a',
    '  retirements.tsv row for a component that genuinely dissolved',
    '  (reinstatements.tsv resumes the sid if it later reappears).',
  );
  return lines.join('\n');
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');
  const { objects, starCount } = await collectObjects();
  const storedEdges = loadStoredEdges();

  const ledgerText = existsSync(LEDGER_PATH)
    ? readFileSync(LEDGER_PATH, 'utf-8')
    : `${LEDGER_HEADER}\n`;
  const retirementsText = existsSync(RETIREMENTS_PATH)
    ? readFileSync(RETIREMENTS_PATH, 'utf-8')
    : `${RETIREMENTS_HEADER}\n`;
  const reinstatementsText = existsSync(REINSTATEMENTS_PATH)
    ? readFileSync(REINSTATEMENTS_PATH, 'utf-8')
    : `${REINSTATEMENTS_HEADER}\n`;
  const ledger = parseLedgerTsv(ledgerText);
  const retirements = parseRetirementsTsv(retirementsText);
  const reinstatements = parseReinstatementsTsv(reinstatementsText);
  const structural = [
    ...validateLedger(ledger),
    ...validateRetirements(retirements, ledger, reinstatements),
    ...validateReinstatements(reinstatements, ledger, retirements),
  ];
  if (structural.length > 0) {
    console.error(`sid:allocate: committed registry is invalid:\n  ${structural.join('\n  ')}`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const result = allocate({ objects, storedEdges, ledger, retirements, reinstatements, today });

  for (const { designation, objects: idxs } of result.ambiguous) {
    console.log(
      `ambiguous (dropped): ${designation} names ${idxs.length} objects — ` +
        idxs.map((i) => objects[i].label).join(' | '),
    );
  }

  let fatal = false;
  if (result.keyless.length > 0) {
    fatal = true;
    console.error(`sid:allocate: ${result.keyless.length} object(s) carry no usable designation:`);
    for (const i of result.keyless) console.error(`  ${objects[i].label}`);
  }
  const orphanedSynth = result.orphaned.get('synth') ?? [];
  if (orphanedSynth.length > 0) {
    fatal = true;
    const currentSynthKeys = objects.flatMap((o) =>
      o.designations.filter((d) => d.startsWith('synth:')).map((d) => parseDesignation(d).key),
    );
    console.error(
      `sid:allocate: ${orphanedSynth.length} ledger synth key(s) vanished from the build ` +
        `(WDS re-subdivision churn):\n` +
        synthChurnReport(
          orphanedSynth.map((k) => parseDesignation(k).key),
          currentSynthKeys,
        ),
    );
  }
  if (result.errors.length > 0) {
    fatal = true;
    console.error(`sid:allocate: ${result.errors.length} error(s):`);
    for (const e of result.errors) console.error(`  ${e}`);
  }
  if (checkOnly && result.minted.length > 0) {
    fatal = true;
    console.error(
      `sid:check: ${result.minted.length} object(s) are not in the committed ` +
        `ledger (would mint):`,
    );
    for (const r of result.minted.slice(0, 20)) {
      console.error(`  ${r.canonicalKey}`);
    }
    if (result.minted.length > 20) {
      console.error(`  … and ${result.minted.length - 20} more`);
    }
    console.error(
      '  Run `pnpm run sid:allocate` and commit the ledger diff in this PR.',
    );
  }
  if (fatal) process.exit(1);

  for (const ns of ['cloud', 'lg']) {
    const keys = result.orphaned.get(ns) ?? [];
    if (keys.length > 0) {
      console.warn(
        `WARNING: ${keys.length} ledger ${ns} slug(s) absent from the current build — a ` +
          `renamed slug needs a bridge in sameas-overrides.tsv: ${keys.join(', ')}`,
      );
    }
  }
  for (const { sid, objects: idxs } of result.mergedClasses) {
    console.log(
      `merged class: sid ${sid} covers ${idxs.length} objects — ` +
        idxs.map((i) => objects[i].label).join(' | '),
    );
  }

  const keyBySid = new Map<number, string>(
    [...ledger, ...result.minted].map((r) => [r.sid, r.canonicalKey]),
  );
  const buckets = new Map<string, number>();
  for (let i = 0; i < starCount; i++) {
    const ns = parseDesignation(keyBySid.get(result.objectSids[i])!).ns;
    buckets.set(ns, (buckets.get(ns) ?? 0) + 1);
  }
  console.log(`canonical-key buckets over ${starCount} catalog records:`);
  for (const [ns, n] of [...buckets].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ns.padEnd(9)} ${String(n).padStart(7)}  (${((n / starCount) * 100).toFixed(2)}%)`);
  }
  console.log(
    `objects: ${objects.length} (${starCount} records + ${objects.length - starCount} ` +
      `cloud/lg/sol) → resolved ${result.resolvedExisting} existing, minted ${result.minted.length}`,
  );

  if (checkOnly) {
    console.log(
      `sid:check OK — ${result.resolvedExisting} objects resolve to the ` +
        `committed ledger, nothing to mint, no orphaned synth keys`,
    );
    return;
  }

  if (result.minted.length > 0) {
    const appended = result.minted.map((r) => `${serializeLedgerRow(r)}\n`).join('');
    if (existsSync(LEDGER_PATH)) appendFileSync(LEDGER_PATH, appended);
    else writeFileSync(LEDGER_PATH, `${LEDGER_HEADER}\n${appended}`);
  }
  if (!existsSync(RETIREMENTS_PATH)) writeFileSync(RETIREMENTS_PATH, retirementsText);
  if (!existsSync(REINSTATEMENTS_PATH)) writeFileSync(REINSTATEMENTS_PATH, reinstatementsText);

  const head = computeLedgerHead(
    readFileSync(LEDGER_PATH, 'utf-8'), retirementsText, reinstatementsText,
  );
  const headJson = `${JSON.stringify(head, null, 2)}\n`;
  if (!existsSync(HEAD_PATH) || readFileSync(HEAD_PATH, 'utf-8') !== headJson) {
    writeFileSync(HEAD_PATH, headJson);
    console.log(`wrote ${HEAD_PATH}`);
  }
  console.log(
    `ledger: ${head.ledger.rows} rows, max_sid ${head.ledger.max_sid}` +
      (result.minted.length > 0 ? ` (+${result.minted.length} minted)` : ' (no change)'),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
