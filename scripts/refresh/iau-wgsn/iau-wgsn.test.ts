import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { REPO_ROOT } from '../../util/paths';
import { describeWgsn, wgsnChecks } from './iau-wgsn-pure';

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

  it('describe the two URLs as the query, the host as the service', () => {
    expect(describeWgsn()).toEqual({
      query: 'https://exopla.net/wp-content/uploads/2025/05/NEC.csv\nhttps://exopla.net/wp-content/uploads/2025/05/wgsnFaints.csv',
      services: ['exopla.net'],
    });
  });
});
