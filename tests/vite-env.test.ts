import { describe, expect, it } from 'vitest';

import { absentCatalogueFor } from '../vite.env';

describe('which Vite builds may run without a built catalogue', () => {
  it('a production build refuses', () => {
    expect(absentCatalogueFor({ mode: 'production' })).toBe('refuse');
  });

  it.each(['development', 'test'])('a %s run quotes the count snapshot', (mode) => {
    expect(absentCatalogueFor({ mode })).toBe('quote-snapshot');
  });
});
