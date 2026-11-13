// The build-catalog count snapshot: its file, its reader, its counts and stage order. See
// /scripts/catalog/validate/README.md#validation-harness-1.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { flattenStages } from '../util/counts/count-stages-pure.ts';
import { REPO_ROOT } from '../util/paths.ts';
import type { PlacementCounts, PlacementDerivedCounts } from './distance/placement-counts-pure.ts';
import type { PromotionDerivedCounts } from './companions/companion-promotion.ts';
import type { PromotionCounts } from './companions/promotion-lineage-pure.ts';
import type { CoherenceCounts } from './multiplicity/coherence-lineage-pure.ts';
import type { BrightnessColourCounts } from './photometry/brightness-colour-lineage-pure.ts';
import type { InputsCounts } from './parse/read-stars-inputs.ts';
import type { FiguresCounts } from './parse/constellations/constellations.ts';
import type { BoundariesCounts } from './boundaries/build-boundaries-artifact.ts';
import type { SearchCounts } from './record/search-index-pure.ts';
import type { GcvsCounts } from './parse/gcvs/gcvs-parse.ts';
import type { MultiplicityCounts } from './multiplicity/multiplicity-stage-pure.ts';
import type { RecordsCounts } from './record/records-stage-pure.ts';
import type { NamingCounts } from './naming/naming-lineage-pure.ts';
import type { NamingDerivedCounts } from './naming/display-names.ts';
import type { AllocationCounts } from '../sid/allocation-lineage-pure.ts';

/** Repo-relative path of the snapshot `BuildCounts` is pinned against, so the
 *  build and every consumer that reads the shipped figures back resolve one
 *  path. */
export const BUILD_COUNTS_EXPECTED_FILE = 'scripts/catalog/build-catalog-expected.json';

/** The committed snapshot's figures: what the catalogue build last pinned. */
export function committedBuildCounts(): BuildCounts {
  return flattenStages(JSON.parse(readFileSync(resolve(REPO_ROOT, BUILD_COUNTS_EXPECTED_FILE), 'utf8'))) as BuildCounts;
}

/** Every count the snapshot holds, by name: each stage's count block. */
export type BuildCounts = InputsCounts & PlacementCounts & PlacementDerivedCounts & BrightnessColourCounts
  & CoherenceCounts & PromotionCounts & PromotionDerivedCounts & MultiplicityCounts & GcvsCounts & AllocationCounts
  & NamingCounts & NamingDerivedCounts & RecordsCounts & SearchCounts & BoundariesCounts & FiguresCounts;

/** The snapshot's stage order, the build's pipeline order; its lineage stages keep LINEAGE_STAGES' order. */
export const CATALOG_COUNT_STAGES = [
  'inputs', 'placement', 'brightness-colour', 'coherence', 'promotion',
  'multiplicity', 'gcvs', 'allocation', 'naming', 'records', 'search', 'boundaries', 'figures',
] as const;
export type CatalogCountStage = (typeof CATALOG_COUNT_STAGES)[number];
