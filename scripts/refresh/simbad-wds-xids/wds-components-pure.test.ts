import { describe, expect, it } from 'vitest';

import { wdsPair } from '../../wds/wds-fixture';
import { componentId, identSuffix, wdsComponents } from './wds-components-pure';

describe('wdsComponents', () => {
  it('takes both sides of each splitting row once, by WDS id then component, and skips a blank or unsplittable field', () => {
    const pairs = [
      wdsPair({ wdsId: '06451-1643', components: 'AB' }),
      wdsPair({ wdsId: '00002+4119', components: 'AB' }),
      wdsPair({ wdsId: '06451-1643', components: 'Aa,Ab' }),
      wdsPair({ wdsId: '06451-1643', components: 'AC' }),
      wdsPair({ wdsId: '11111+1111', components: '' }),
      wdsPair({ wdsId: '22222+2222', components: 'ABC' }),
    ];
    expect(wdsComponents(pairs).map(componentId)).toEqual([
      '00002+4119 A', '00002+4119 B', '06451-1643 A', '06451-1643 Aa', '06451-1643 Ab', '06451-1643 B', '06451-1643 C',
    ]);
  });

  it('spells the WDS ident suffix with no space', () => {
    expect(identSuffix({ wdsId: '06451-1643', component: 'B' })).toBe('06451-1643B');
  });
});
