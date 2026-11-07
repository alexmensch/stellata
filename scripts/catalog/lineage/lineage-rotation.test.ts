import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileHashes } from '../../util/build-stamp';
import { declareOutputs, emitArtifacts, EmissionRefused } from '../../util/emit-artifacts';
import { headCommit } from '../../util/git-provenance';
import { REPO_ROOT } from '../../util/paths';
import { judgeBaseline, type BaselineContext, type StageProvenance } from './baseline/lineage-header-pure';
import { baselineMembers, readLineage, readStageHeader, stageEmission } from './lineage-io';
import { lineageInvariant, NO_EXCEPTIONS } from './lineage-invariant-pure';
import { paramsText, stageLineageLine, stageLineageText } from './lineage-row-pure';
import { inputsAtFrom, stageLineage, upstreamLineage } from './stage-lineage';
import { LIVE, stageCodes } from './reason-codes-pure';
import {
  lineageLayout, stageFamilies, stageFile, stageFileName, stageOutputFiles, type LineageLayout,
} from '../../../src/catalog-format/pipeline-outputs/lineage-files';

const SPEC = { stage: 'demo', files: ['demo', 'identity'] as const };
const CODES = stageCodes('demo', { kept: { description: 'kept', effect: 'none', status: LIVE } });

let dir: string;
let layout: LineageLayout;

const header = (commit: string): StageProvenance => ({
  stage: 'demo', version: '1.0.0', commit, inputs: { 'demo.in': 'h' },
});
const BASE: BaselineContext = {
  base: { kind: 'fixed', commit: 'base', paths: () => [] },
  inputsAt: (_commit, paths) => ({ kind: 'hashed', hashes: Object.fromEntries(paths().map((p) => [p, 'h'])) }),
};

function text(source: string): Uint8Array {
  return stageLineageText(CODES, [stageLineageLine(CODES, {
    stage: 'demo', key: 'spine:2', role: 'outcome', code: 'demo.kept', params: paramsText({ source }), evidence: [],
  })]);
}

function run(source: string, opts: { fail?: boolean; diff?: Uint8Array | null; rotate?: boolean } = {}): void {
  const outputs = declareOutputs(stageOutputFiles(layout, SPEC), stageFamilies(layout, SPEC));
  const { files, members } = stageEmission(
    layout, SPEC, { demo: text(source), identity: text(`id-${source}`) }, header(source), opts.diff ?? null,
    opts.rotate ?? true,
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
    run('two', { diff: Buffer.from('change\n') });
    expect(readFileSync(stageFile(layout.previous, 'demo'))).toEqual(first);
    expect(readLineage(stageFile(layout.current, 'demo'))[0].params).toBe('{"source":"two"}');
    expect(readFileSync(resolve(layout.previous, 'demo.header.json'), 'utf8')).toMatch(/"commit": "one"/);
    expect(readFileSync(resolve(layout.diff, 'demo.tsv'), 'utf8')).toBe('change\n');
    for (const d of [layout.current, layout.previous]) {
      expect(readFileSync(resolve(d, 'placement.tsv.gz'), 'utf8')).toBe(`other stage, ${d}`);
    }
  });

  it('keeps a pinned merge-base baseline across branch builds that do not rotate', () => {
    run('base');
    run('branch-1');
    const pinned = readFileSync(stageFile(layout.previous, 'demo'));
    run('branch-2', { rotate: false });
    run('branch-3', { rotate: false });
    expect(readFileSync(stageFile(layout.previous, 'demo'))).toEqual(pinned);
    expect(readFileSync(resolve(layout.previous, 'demo.header.json'), 'utf8')).toMatch(/"commit": "base"/);
    expect(readLineage(stageFile(layout.current, 'demo'))[0].params).toBe('{"source":"branch-3"}');
  });

  it('a header seeded beside another build\'s stage file is refused as a baseline', () => {
    run('one');
    const theirs = readFileSync(stageFile(layout.current, 'demo'));
    run('base');
    expect(judgeBaseline({ kind: 'checkout', header: readStageHeader(layout.current, SPEC) }, BASE, false))
      .toEqual({ kind: 'diff', why: 'matched' });
    writeFileSync(stageFile(layout.current, 'demo'), theirs);
    const verdict = judgeBaseline({ kind: 'checkout', header: readStageHeader(layout.current, SPEC) }, BASE, false);
    expect(verdict.kind === 'refused' && verdict.message)
      .toMatch(/whose demo\.tsv\.gz is not the file its header \(built at base\) recorded/);
  });

  it('a run with no diff deletes the stale one', () => {
    run('one', { diff: Buffer.from('change\n') });
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

  it('a broken invariant fails the stage\'s emission, so nothing lands', async () => {
    run('one');
    const before = snapshot();
    const line = stageLineageLine(CODES, {
      stage: 'demo', key: 'spine:9', role: 'outcome', code: 'demo.kept', params: '', evidence: [],
    });
    const emission = stageLineage({
      layout, spec: SPEC, inputs: {}, diffed: 'demo', lines: () => [line],
      render: (sorted) => ({ demo: stageLineageText(CODES, sorted), identity: stageLineageText(CODES, sorted) }),
      joins: () => [],
      budget: { gzipBytes: 1e9, writeMs: 1e9 },
      invariants: [lineageInvariant(CODES, 'kept', 'nothing is kept', NO_EXCEPTIONS)],
      argv: [],
    });
    const failed = emission.checks.filter((c) => c.kind === 'fail');
    expect(failed.map((c) => c.kind === 'fail' && c.message.split('\n')[1])).toEqual(['  spine:9\tdemo.kept\t']);
    const outputs = declareOutputs(stageOutputFiles(layout, SPEC), stageFamilies(layout, SPEC));
    expect(() => emitArtifacts({ outputs, files: emission.files, members: emission.members, checks: emission.checks }))
      .toThrow(EmissionRefused);
    expect(snapshot()).toEqual(before);
  });

  it('a build that never emits moves nothing: reading the rotation writes no file', () => {
    run('one');
    run('two');
    const before = snapshot();
    baselineMembers(layout, SPEC, true);
    baselineMembers(layout, SPEC, false);
    expect(snapshot()).toEqual(before);
  });

  it('a git failure while hashing the merge-base\'s inputs refuses the baseline, once, and fails nothing', () => {
    run('old');
    let calls = 0;
    const failing: BaselineContext = {
      base: BASE.base,
      inputsAt: inputsAtFrom({}, () => {
        calls += 1;
        throw new Error('git exited 128');
      }),
    };
    const source = { kind: 'checkout' as const, header: readStageHeader(layout.current, SPEC) };
    for (let i = 0; i < 2; i++) {
      const verdict = judgeBaseline(source, failing, false);
      expect(verdict.kind === 'refused' && verdict.message).toMatch(/hashing them failed: git exited 128/);
    }
    expect(calls).toBe(1);
  });

  it('a git failure while listing the branch\'s paths refuses the baseline, and fails nothing', () => {
    run('old');
    const failing: BaselineContext = {
      base: { kind: 'fixed', commit: 'base', paths: () => { throw new Error('git diff exited 128'); } },
      inputsAt: inputsAtFrom({}, () => ({ kind: 'known', hashes: {} })),
    };
    const source = { kind: 'checkout' as const, header: readStageHeader(layout.current, SPEC) };
    const verdict = judgeBaseline(source, failing, false);
    expect(verdict.kind === 'refused' && verdict.message).toMatch(/hashing them failed: git diff exited 128/);
  });

  it('an upstream stage\'s files stand for a commit exactly when its header\'s inputs are that commit\'s, hashed once', () => {
    const emitUpstream = (inputs: Readonly<Record<string, string | null>>) => {
      const { files, members } = stageEmission(
        layout, SPEC, { demo: text('up'), identity: text('id-up') },
        { stage: 'demo', version: '1.0.0', commit: 'up', inputs }, null, false,
      );
      emitArtifacts({ outputs: declareOutputs(stageOutputFiles(layout, SPEC), stageFamilies(layout, SPEC)), files, members, checks: [] });
    };
    const head = headCommit();
    emitUpstream(fileHashes([resolve(REPO_ROOT, 'package.json')]));
    const read = readStageHeader(layout.current, SPEC);
    const recorded = read.kind === 'read' ? read.header.files : {};
    const upstream = upstreamLineage(layout, [SPEC]);
    const known = upstream.filesAt(head);
    expect(known).toEqual({
      kind: 'known',
      hashes: Object.fromEntries(SPEC.files.map((stem) => [
        relative(REPO_ROOT, stageFile(layout.current, stem)), recorded[stageFileName(stem)],
      ])),
    });
    expect(upstream.filesAt(head)).toBe(known);
    emitUpstream({ 'package.json': 'not what HEAD holds' });
    expect(upstreamLineage(layout, [SPEC]).filesAt(head)).toEqual({ kind: 'known', hashes: {} });
  });
});
