// Minimal LgObjectRow for tests that exercise the naming layer, where only
// `name` / `type` / `aliases` are read.

import type { LgObjectRow } from '../../src/catalog-format/local-group/local-group-schema';

export function lgObjectStub(name: string): LgObjectRow {
  return {
    name,
    id: 'x',
    type: '',
    center: [0, 0, 0],
    kind: 'ellipsoid',
    axes: [1, 1, 1],
    quat: [0, 0, 0, 1],
    source: 'LVDB',
    distance: 1,
    emission: {
      family: 'sersic',
      mV: 1,
      reffAxesPc: [1, 1, 1],
      n: 1,
      bn: 1,
      pn: 1,
      uMax: 1,
      density0: 1,
    },
  };
}
