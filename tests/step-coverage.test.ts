// Every declareOutputs constant under scripts/ belongs to a step on the table, a writer excluded by name, or a step still to move. See ../scripts/pipeline/README.md#the-model.

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { STEPS } from '../scripts/pipeline/step-table/steps';
import { packageScripts } from '../scripts/util/import-closure';
import { REPO_ROOT } from '../scripts/util/paths';
import { isProductionTs, walkFiles } from './walk-files';

type Ref = `${string}#${string}`;

/** Report, draft and on-demand writers: no step reads what they write. */
const EXCLUDED: Readonly<Record<string, readonly Ref[]>> = {
  'sid:dr-reconcile': ['scripts/sid/dr-reconcile-outputs.ts#DR_RECONCILE_OUTPUTS'],
  'sid:risk-set': ['scripts/sid/dr-risk-set-outputs.ts#DR_RISK_SET_OUTPUTS'],
  'identity:snapshot': [],
  'build:lut': ['scripts/colour/blackbody-lut-outputs.ts#LUT_OUTPUTS'],
  'build:naming-parity': ['scripts/catalog/naming/naming-parity-outputs.ts#NAMING_PARITY_OUTPUTS'],
  'build:vaidman-table': ['scripts/distance-validation/vaidman-outputs.ts#VAIDMAN_OUTPUTS'],
};

/** Steps whose move onto the table is a later item's; each entry goes when its step joins steps.ts. */
const NOT_YET_MIGRATED: Readonly<Record<Ref, string>> = {
  'scripts/local-group/local-group-outputs.ts#LOCAL_GROUP_OUTPUTS': 'build:local-group',
  'scripts/clouds/clouds-outputs.ts#CLOUDS_OUTPUTS': 'build:clouds',
};

const DECLARATION = /^(export )?const (\w+) = declareOutputs\(/gm;

const CALL = /\bdeclareOutputs\(/g;
const DEFINITION = 'scripts/util/emit-artifacts.ts';

interface Scan {
  readonly constants: readonly { ref: Ref; exported: boolean }[];
  readonly unparsed: readonly string[];
}

function scan(): Scan {
  const constants: { ref: Ref; exported: boolean }[] = [];
  const unparsed: string[] = [];
  for (const file of walkFiles(`${REPO_ROOT}/scripts`, { include: isProductionTs })) {
    const module = relative(REPO_ROOT, file);
    if (module === DEFINITION) continue;
    const text = readFileSync(file, 'utf8');
    const matches = [...text.matchAll(DECLARATION)];
    if (matches.length !== [...text.matchAll(CALL)].length) unparsed.push(module);
    for (const m of matches) constants.push({ ref: `${module}#${m[2]}`, exported: m[1] !== undefined });
  }
  return { constants, unparsed };
}

const declaredConstants = (): Scan['constants'] => scan().constants;

const tableRefs = new Set<Ref>(STEPS.steps.flatMap((s) => (
  s.language === 'ts' ? [`${s.outputs.module}#${s.outputs.name}` as Ref] : []
)));
const excludedRefs = new Set<Ref>(Object.values(EXCLUDED).flat());

describe('declareOutputs coverage', () => {
  it('finds every constant, each exported so the table can name it', () => {
    expect(scan().unparsed).toEqual([]);
    const found = declaredConstants();
    expect(found.length).toBeGreaterThan(tableRefs.size);
    expect(found.filter((c) => !c.exported).map((c) => c.ref)).toEqual([]);
  });

  it('places every constant on the table, the exclusion list or the not-yet-migrated list', () => {
    const unplaced = declaredConstants().map((c) => c.ref)
      .filter((ref) => !tableRefs.has(ref) && !excludedRefs.has(ref) && !(ref in NOT_YET_MIGRATED));
    expect(unplaced).toEqual([]);
  });

  it('names only constants that exist, each in one list', () => {
    const found = new Set(declaredConstants().map((c) => c.ref));
    const listed = [...tableRefs, ...excludedRefs, ...Object.keys(NOT_YET_MIGRATED) as Ref[]];
    expect(listed.filter((ref) => !found.has(ref))).toEqual([]);
    expect(listed.filter((ref, i) => listed.indexOf(ref) !== i)).toEqual([]);
  });

  it('keys the exclusion and not-yet-migrated lists on package.json scripts off the table', () => {
    const scripts = packageScripts();
    const tableNames = new Set(STEPS.steps.map((s) => s.name));
    const names = [...Object.keys(EXCLUDED), ...Object.values(NOT_YET_MIGRATED)];
    expect(names.filter((name) => !(name in scripts))).toEqual([]);
    expect(names.filter((name) => tableNames.has(name))).toEqual([]);
  });
});
