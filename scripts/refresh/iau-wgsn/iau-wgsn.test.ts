import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { REPO_ROOT } from '../../util/paths';
import { TapRefused, TapTransient } from '../pull/tap-pure';
import { describeWgsn, fetchedText, wgsnChecks } from './iau-wgsn-pure';

const committed = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');
const kinds = (key: 'nec' | 'faints', text: string) => wgsnChecks(key, text).map((c) => c.kind);

describe('the WGSN gates', () => {
  it('pass both committed files', () => {
    expect(kinds('nec', committed(DATA_FILES.wgsnNec))).toEqual(['pass', 'pass', 'pass']);
    expect(kinds('faints', committed(DATA_FILES.wgsnFaints))).toEqual(['pass', 'pass', 'pass']);
  });

  it('refuse a changed header before reading a row', () => {
    const [check, ...rest] = wgsnChecks('faints', committed(DATA_FILES.wgsnFaints).replace('WGSN-ID', 'ID'));
    expect(rest).toEqual([]);
    expect(check.kind === 'fail' && check.message).toMatch(/upstream header changed/);
  });

  it('fail a file with too few rows, too few names or a spot row gone', () => {
    const [header, ...lines] = committed(DATA_FILES.wgsnFaints).split('\n');
    expect(kinds('faints', `${[header, ...lines.slice(0, 50)].join('\n')}\n`)).toEqual(['fail', 'fail', 'pass']);
    expect(kinds('faints', `${[header, ...lines.filter((l) => !l.startsWith('10001,'))].join('\n')}`)).toEqual(['pass', 'pass', 'fail']);
  });

  it('read a 200 as UTF-8 with its byte-order mark dropped, retry a 5xx, refuse any other status', () => {
    const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
    expect(fetchedText('u', 200, bytes('﻿NEC,Name\nτ\n'))).toBe('NEC,Name\nτ\n');
    expect(() => fetchedText('u', 503, bytes(''))).toThrow(TapTransient);
    expect(() => fetchedText('u', 404, bytes(''))).toThrow(TapRefused);
    expect(() => fetchedText('u', 301, bytes(''))).toThrow(TapRefused);
  });

  it('describe the two URLs as the query, the host as the service', () => {
    expect(describeWgsn()).toEqual({
      query: 'https://exopla.net/wp-content/uploads/2025/05/NEC.csv\nhttps://exopla.net/wp-content/uploads/2025/05/wgsnFaints.csv',
      services: ['exopla.net'],
    });
  });
});
