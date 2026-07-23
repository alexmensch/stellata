// Cross-language parity: gaia-xmatch.ts's parseGaiaHipXmatchTsv and
// parsers.py's parse_gaia_hip_xmatch read the SAME fixture — drift in
// either parser (tie-break, skip guards, big-int handling) fails here.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { parseGaiaHipXmatchTsv } from './gaia-xmatch';
import { REPO_ROOT } from '../util/paths';

const FIXTURE = resolve(REPO_ROOT, 'scripts/catalog/gaia-hip-xmatch-parity.tsv');

// gaia_source_id is compared as a decimal string on both sides: the TS
// parser keeps strings to preserve bits beyond 2^53, and Python's
// arbitrary-precision int stringifies exactly, so a >2^53 fixture value
// still compares directly.
const EXPECTED: Record<string, string> = {
  '2': '2341871673090078592',
  '5': '222222222222222222', // nearest angular_distance wins
  '7': '555555555555555555', // missing angular_distance loses the tie-break
  '9': '9876543210123456789', // > 2^53, bits preserved
};

const PY_DUMP = `
import json, sys
sys.path.insert(0, "scripts/binaries")
from pathlib import Path
from parsers import parse_gaia_hip_xmatch
m = parse_gaia_hip_xmatch(Path(sys.argv[1]))
print(json.dumps({str(h): str(s) for h, s in m.items()}))
`;

describe('gaia-hip-xmatch parity (parsers.py vs gaia-xmatch.ts)', () => {
  it('both parsers reduce the shared fixture to the same hip → gaia_source_id map', () => {
    const tsMap = parseGaiaHipXmatchTsv(readFileSync(FIXTURE, 'utf8'));
    const ts: Record<string, string> = {};
    for (const [hip, src] of tsMap) ts[String(hip)] = src;

    const raw = execFileSync('python3', ['-c', PY_DUMP, FIXTURE], {
      cwd: resolve(REPO_ROOT),
      encoding: 'utf8',
    });
    const py = JSON.parse(raw) as Record<string, string>;

    expect(ts).toEqual(EXPECTED);
    expect(py).toEqual(EXPECTED);
    expect(ts).toEqual(py);
  });
});
