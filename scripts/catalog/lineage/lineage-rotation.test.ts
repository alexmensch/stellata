import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareOutputs, emitArtifacts, EmissionRefused } from '../../util/emit-artifacts';
import type { StageHeader } from './lineage-header-pure';
import {
  lineageLayout, readLineage, rotationMembers, stageEmission, stageFamilies, stageFile,
  stageOutputFiles, type LineageLayout,
} from './lineage-io';
import { paramsText, stageLineageText } from './lineage-row-pure';
import { LIVE, stageCodes } from './reason-codes-pure';

const SPEC = { stage: 'demo', files: ['demo', 'identity'] as const };
const CODES = stageCodes('demo', { kept: { description: 'kept', effect: 'none', status: LIVE } });

let dir: string;
let layout: LineageLayout;

const header = (commit: string): StageHeader => ({
  stage: 'demo', version: '1.0.0', commit, inputHash: 'h', files: ['demo.tsv.gz', 'identity.tsv.gz'],
});

function text(source: string): string {
  return stageLineageText(CODES, [{
    stage: 'demo', key: 'spine:2', role: 'outcome', code: 'demo.kept', params: paramsText({ source }), evidence: [],
  }]);
}

function run(source: string, opts: { fail?: boolean; diff?: string | null } = {}): void {
  const outputs = declareOutputs(stageOutputFiles(layout, SPEC), stageFamilies(layout, SPEC));
  const { files, members } = stageEmission(
    layout, SPEC, { demo: text(source), identity: text(`id-${source}`) }, header(source), opts.diff ?? null,
  );
  emitArtifacts({
    outputs, files, members,
    checks: opts.fail ? [{ kind: 'fail', message: 'demo check failed' }] : [],
  });
}

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sub of ['lineage', 'lineage.previous', 'lineage-diff']) {
    let names: string[] = [];
    try {
      names = readdirSync(join(dir, sub));
    } catch {
      continue;
    }
    for (const name of names) out[`${sub}/${name}`] = readFileSync(join(dir, sub, name)).toString('base64');
  }
  return out;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lineage-rotation-'));
  layout = lineageLayout(dir);
  for (const d of [layout.current, layout.previous]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(resolve(d, 'placement.tsv.gz'), `other stage, ${d}`);
    writeFileSync(resolve(d, 'placement.header.json'), '{}');
  }
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('stage rotation', () => {
  it('moves the last build into the baseline in the same emission, and nothing else', () => {
    run('one');
    expect(readdirSync(layout.previous).sort()).toEqual(['placement.header.json', 'placement.tsv.gz']);
    const first = readFileSync(stageFile(layout.current, 'demo'));
    run('two', { diff: 'change\n' });
    expect(readFileSync(stageFile(layout.previous, 'demo'))).toEqual(first);
    expect(readLineage(stageFile(layout.current, 'demo'))[0].params).toBe('{"source":"two"}');
    expect(readFileSync(resolve(layout.previous, 'demo.header.json'), 'utf8')).toMatch(/"commit": "one"/);
    expect(readFileSync(resolve(layout.diff, 'demo.tsv'), 'utf8')).toBe('change\n');
    for (const d of [layout.current, layout.previous]) {
      expect(readFileSync(resolve(d, 'placement.tsv.gz'), 'utf8')).toBe(`other stage, ${d}`);
    }
  });

  it('a run with no diff deletes the stale one', () => {
    run('one', { diff: 'change\n' });
    run('two');
    expect(readdirSync(layout.diff)).toEqual([]);
  });

  it('a failed build leaves the baseline and the current files byte-identical', () => {
    run('one');
    run('two');
    const before = snapshot();
    expect(() => run('three', { fail: true })).toThrow(EmissionRefused);
    expect(snapshot()).toEqual(before);
  });

  it('a build that never emits moves nothing: reading the rotation writes no file', () => {
    run('one');
    run('two');
    const before = snapshot();
    rotationMembers(layout, SPEC);
    expect(snapshot()).toEqual(before);
  });
});
