import { describe, it, expect } from 'vitest';
import { LINEAGE_STAGES } from './lineage/lineage-stages';
import { CATALOG_COUNT_STAGES } from './build-counts';

describe('CATALOG_COUNT_STAGES', () => {
  it('orders its lineage stages as LINEAGE_STAGES does', () => {
    const lineageOrder = LINEAGE_STAGES.map((s) => s.spec.stage);
    const filed = CATALOG_COUNT_STAGES.filter((stage) => (lineageOrder as readonly string[]).includes(stage));
    expect(filed).toEqual(lineageOrder.filter((stage) => (filed as readonly string[]).includes(stage)));
    expect(filed.length).toBeGreaterThan(1);
  });
});
