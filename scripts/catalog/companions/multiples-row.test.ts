import { describe, expect, it } from 'vitest';
import { multiplesRow } from './multiples-fixture';
import { companionOwnGaiaSources } from './multiples-row';

describe('companionOwnGaiaSources', () => {
  it('takes a secondary\'s own source, never a primary\'s nor a blend it shares with its primary', () => {
    const rows = [
      multiplesRow({ systemId: 'X-AB', comp: 'A', orbitRole: 'primary', gaiaSourceId: '1' }),
      multiplesRow({ systemId: 'X-AB', comp: 'B', orbitRole: 'secondary', gaiaSourceId: '2' }),
      multiplesRow({ systemId: 'Y-AB', comp: 'A', orbitRole: 'primary', gaiaSourceId: '3' }),
      multiplesRow({ systemId: 'Y-AB', comp: 'B', orbitRole: 'secondary', gaiaSourceId: '3' }),
      multiplesRow({ systemId: 'Z-AB', comp: 'B', orbitRole: 'secondary', gaiaSourceId: null }),
      multiplesRow({ systemId: 'S', comp: 'A', orbitRole: 'standalone', gaiaSourceId: '4' }),
    ];
    expect([...companionOwnGaiaSources(rows)]).toEqual(['2']);
  });
});
