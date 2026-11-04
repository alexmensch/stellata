import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { describeStep, readManualRecord, writeManualRecord, type ManualRecord } from './freshness';
import { pipelineTree } from './pipeline-tree';
import type { ManualStep } from './step-table/step-table-pure';

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'freshness-'))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const pull: ManualStep = { name: 'refresh:x', kind: 'pull', language: 'python', entry: 'x.py', outputs: ['x.tsv'] };
const bake: ManualStep = { name: 'build:y', kind: 'bake', describes: true, language: 'python', entry: 'y.py', outputs: ['y.bin'] };
const stamp = { inputs: { 'req.tsv': 'a1' }, outputs: { 'x.tsv': 'b2' } };

describe('writeManualRecord', () => {
  it.each<[ManualStep, ManualRecord]>([
    [pull, { kind: 'pull', stamp, query: 'q', answeredBy: ['ESA-sync', 'ARI-sync'], release: 'Gaia DR3', request: 'r', requestFrom: ['m.tsv'] }],
    [pull, { kind: 'pull', stamp, query: 'q', answeredBy: [], requestFrom: [] }],
    [bake, { kind: 'bake', stamp, request: 'g', requestFrom: ['clouds.json'] }],
  ])('writes what readManualRecord reads back (%#)', (step, record) => {
    const file = pipelineTree(root).manualStamp(step.name);
    mkdirSync(dirname(file), { recursive: true });
    writeManualRecord(file, record);
    expect(readManualRecord(step, file)).toEqual({ kind: 'read', record });
  });

  it('reads a pull record whose answeredBy is not a list as unreadable', () => {
    const file = join(root, 'r.json');
    writeFileSync(file, JSON.stringify({ ...stamp, query: 'q', answeredBy: 'ESA-sync' }));
    expect(readManualRecord(pull, file)).toEqual({ kind: 'unreadable' });
  });
});

describe('describeStep', () => {
  const describing = (body: string): string => {
    writeFileSync(join(root, 'x.py'), `import json, sys\nif sys.argv[1:] == ["--describe"]:\n    print(json.dumps(${body}))\n`);
    return 'x.py';
  };

  it('parses a pull\'s description, defaulting requestFrom to none', () => {
    describing('{"query": "SELECT 1", "services": ["CDS"], "release": "VizieR I/239"}');
    expect(describeStep(pull, pipelineTree(root))).toEqual({
      kind: 'pull', query: 'SELECT 1', services: ['CDS'], release: 'VizieR I/239', request: undefined, requestFrom: [],
    });
  });

  it('refuses a pull that names no service', () => {
    describing('{"query": "SELECT 1", "services": []}');
    expect(() => describeStep(pull, pipelineTree(root))).toThrow(/at least one service/);
  });

  it('describes a TypeScript step through tsx', () => {
    writeFileSync(join(root, 'x.ts'), 'if (process.argv.includes(\'--describe\')) console.log(JSON.stringify({ query: \'Q\', services: [\'Horizons\'] }));\n');
    expect(describeStep({ ...pull, language: 'ts', entry: 'x.ts', outputs: { module: 'm.ts', name: 'OUT' } }, pipelineTree(root)))
      .toMatchObject({ kind: 'pull', query: 'Q', services: ['Horizons'] });
  });
});
