// Cross-language parity: mass_estimate.py mirrors catalog-pure.ts's
// spectral encoding with no shared source of truth — this corpus fails
// when either side renumbers a class or drifts on the parse surface.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { classifyFromSimbad } from './catalog-pure';
import { REPO_ROOT } from '../util/paths';

// The parse surface both sides document handling: plain MK across every
// class letter and luminosity code, white dwarfs, subdwarfs, Yerkes
// prefixes, carbon/S/WR, Am/Ap composites, and unparseable strings.
// Fields beyond the shared quadruple (TS wdSubclass / isWolfRayet) are
// deliberately out of scope — Python's mass tables don't consume them.
const CORPUS = [
  'O5V', 'B2III', 'A1V', 'F5IV', 'G2V', 'K0III', 'M1.5Iab',
  'B0Ia', 'A0Ia+', 'G8Ib', 'B2II', 'K1IV', 'M4.5V', 'F8VI',
  'DA1.9', 'DQZ', 'DBV4',
  'sdB5', 'sdO',
  'dM4.0', 'gK0',
  'C5,2e', 'WN5', 'S4,2',
  'kA5hA8mF1(III)',
  '', '???',
];

interface SharedShape {
  classIdx: number;
  subclass: number;
  lumClass: number;
  isWhiteDwarf: boolean;
}

const PY_DUMP = `
import json, sys
sys.path.insert(0, "scripts/binaries")
from mass_estimate import parse_spectral_type
out = {}
for s in json.load(sys.stdin):
    p = parse_spectral_type(s)
    out[s] = None if p is None else {
        "classIdx": p.classIdx, "subclass": p.subclass,
        "lumClass": p.lumClass, "isWhiteDwarf": p.isWhiteDwarf,
    }
print(json.dumps(out))
`;

describe('spectral-encoding parity (mass_estimate.py vs catalog-pure.ts)', () => {
  it('both sides parse the shared corpus to identical class/subclass/lum encodings', () => {
    const raw = execFileSync('python3', ['-c', PY_DUMP], {
      cwd: resolve(REPO_ROOT),
      input: JSON.stringify(CORPUS),
      encoding: 'utf8',
    });
    const py = JSON.parse(raw) as Record<string, SharedShape | null>;
    for (const s of CORPUS) {
      const t = classifyFromSimbad(s);
      const ts: SharedShape | null = t === null ? null : {
        classIdx: t.classIdx, subclass: t.subclass,
        lumClass: t.lumClass, isWhiteDwarf: t.isWhiteDwarf,
      };
      expect(ts, `"${s}"`).toEqual(py[s]);
    }
  });
});
