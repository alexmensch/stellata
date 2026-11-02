// The step table: one entry per producer of a file the build or a pull depends on. See README.md#the-step-table--stepsts.

import type { StepTable } from './step-table-pure';

export const STEPS: StepTable = { steps: [], registryFiles: [] };
