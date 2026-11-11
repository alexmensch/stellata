// Codec for build/binding-integrity-verdicts.tsv, the binding audit's review surface. See README.md#files-in-this-area.

import { defineArtifact } from '../../util/tsv/artifact-pure';
import { BUILD_FILES } from '../../../src/catalog-format/pipeline-outputs/build-files';
import { BINDING_SHAPES, BINDING_VERDICTS, byError, type BindingShape, type BindingVerdict, type BindingVerdictKind } from './binding-audit-pure';

export interface BindingVerdictRow {
  wdsId: string;
  shape: BindingShape;
  verdict: BindingVerdictKind;
  contested: string;
  referenceToken: string;
  referenceSource: string;
  winner: string;
  /** `label=err@sep` per candidate, error ascending, `;`-joined; err `inf` when unreachable. */
  candidates: string;
}

export function bindingVerdictRow(v: BindingVerdict): BindingVerdictRow {
  const candidates = [...v.candidates]
    .sort(byError)
    .map((c) => `${c.label}=${Number.isFinite(c.errArcsec) ? c.errArcsec.toFixed(3) : 'inf'}@${c.predictedSepArcsec.toFixed(1)}`)
    .join(';');
  return {
    wdsId: v.wdsId, shape: v.shape, verdict: v.verdict, contested: v.contested,
    referenceToken: v.reference?.token ?? '', referenceSource: v.reference?.sourceId ?? '',
    winner: v.winner?.label ?? '', candidates,
  };
}

export const BINDING_VERDICTS_TSV = defineArtifact({
  file: BUILD_FILES.bindingVerdicts,
  columns: ['wds_id', 'shape', 'verdict', 'contested', 'reference_token', 'reference_source', 'winner', 'candidates'] as const,
  hint: 'Re-run `pnpm run build:binaries`.',
  order: 'as-given',
  decode: (row): BindingVerdictRow => ({
    wdsId: row.raw('wds_id'),
    shape: row.oneOf('shape', BINDING_SHAPES),
    verdict: row.oneOf('verdict', BINDING_VERDICTS),
    contested: row.raw('contested'),
    referenceToken: row.raw('reference_token'),
    referenceSource: row.raw('reference_source'),
    winner: row.raw('winner'),
    candidates: row.raw('candidates'),
  }),
  encode: (r) => ({
    wds_id: r.wdsId, shape: r.shape, verdict: r.verdict, contested: r.contested,
    reference_token: r.referenceToken, reference_source: r.referenceSource, winner: r.winner, candidates: r.candidates,
  }),
});
