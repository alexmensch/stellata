import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { ANSWERED_BY_ENV, readAnsweredBy } from './answered-by';
import { HORIZONS_SERVICE, fetchHorizonsText } from './horizons-response';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('reports Horizons as the answering service once an answer arrives', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'horizons-'));
  const file = join(dir, 'answered-by.json');
  vi.stubEnv(ANSWERED_BY_ENV, file);
  vi.stubGlobal('fetch', async () => new Response('$$SOE\n1\n$$EOE'));
  try {
    expect(await fetchHorizonsText(new URLSearchParams())).toBe('$$SOE\n1\n$$EOE');
    expect(readAnsweredBy(file)).toEqual([HORIZONS_SERVICE]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
