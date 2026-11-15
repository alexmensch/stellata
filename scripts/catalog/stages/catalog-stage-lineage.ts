// build:catalog's lineage stages, each declared against membership's lineage upstream. See README.md.

import { MEMBERSHIP_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';
import { LINEAGE_LAYOUT } from '../lineage/lineage-layout-pure';
import type { StageCodes } from '../lineage/reason-codes/reason-codes-pure';
import {
  countedStageLineage, namedStageRun, stageLineage, upstreamLineage, type NamedStage, type StageLineageRun,
} from '../lineage/stage-lineage';

const UPSTREAM_LINEAGE = upstreamLineage(LINEAGE_LAYOUT, [MEMBERSHIP_LINEAGE]);

type CatalogStage<F extends string, S extends F, C extends StageCodes<string, S>> = NamedStage<F, S, C>;

function catalogStageRun<F extends string, S extends F, C extends StageCodes<string, S>>(
  stage: CatalogStage<F, S, C>,
): StageLineageRun<F, S> {
  return namedStageRun({ ...stage, upstream: UPSTREAM_LINEAGE });
}

export function catalogStageLineage<F extends string, S extends F, C extends StageCodes<string, S>>(
  stage: CatalogStage<F, S, C>,
) {
  return stageLineage(catalogStageRun(stage));
}

export function catalogCountedStageLineage<F extends string, S extends F, B extends string, L extends B>(
  stage: CatalogStage<F, S, StageCodes<B, S, L>>,
) {
  return countedStageLineage(catalogStageRun(stage), stage.codes);
}
