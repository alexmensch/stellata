import { describe, expect, it } from 'vitest';

import { lineageLayout, stagesOutputFiles, type StageLineageSpec } from '../../../src/catalog-format/pipeline-outputs/lineage-files';
import { mergedEmissions, type StageLineageEmission } from './stage-lineage';

const A: StageLineageSpec<'a', 'a'> = { stage: 'a', files: ['a'] };
const B: StageLineageSpec<'b' | 'b.identity', 'b'> = { stage: 'b', files: ['b', 'b.identity'] };

describe('stagesOutputFiles', () => {
  it('declares every listed stage\'s files and header', () => {
    expect(Object.keys(stagesOutputFiles(lineageLayout('build'), [A, B])).sort()).toEqual([
      'lineage:a', 'lineage:a.header', 'lineage:b', 'lineage:b.header', 'lineage:b.identity',
    ]);
  });
});

describe('mergedEmissions', () => {
  it('carries every stage\'s files, members and checks, in the order given', () => {
    const emission = (stage: string): StageLineageEmission<string, string> => ({
      files: { [`lineage:${stage}`]: stage },
      members: new Map([[`${stage}.tsv.gz`, stage]]),
      checks: [{ kind: 'pass', report: stage }],
      changes: null,
    });
    const merged = mergedEmissions([emission('a'), emission('b')]);
    expect([Object.keys(merged.files), [...merged.members.keys()], merged.checks.map((c) => c.kind === 'pass' && c.report)]).toEqual([
      ['lineage:a', 'lineage:b'], ['a.tsv.gz', 'b.tsv.gz'], ['a', 'b'],
    ]);
  });
});
