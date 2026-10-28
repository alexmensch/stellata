import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { lfsContentReadable } from '../util/paths';
import { LEDGER } from './ledger-tsv';
import { LEDGER_PATH } from './registry-io';

describe.skipIf(!lfsContentReadable(LEDGER_PATH))('ledger.tsv codec over the committed file', () => {
  it('round-trips byte for byte', () => {
    const text = readFileSync(LEDGER_PATH, 'utf8');
    expect(LEDGER.serialize(LEDGER.parse(text)) === text).toBe(true);
  });
});
