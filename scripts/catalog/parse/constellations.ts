// IAU-88 constellation table, the Stellarium stick-figure and boundary-edge
// readers, and positional membership in the table's index space.
// See README.md § Positional constellation membership.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  constellationKey,
  createIauConstellationLookup,
  type IauConstellationLookup,
} from '../../../src/client/constellation-boundaries/iau-geometry/iau-boundaries-pure';
import { raDecFromUnitVector } from '../../../src/client/util/equatorial-basis';
import { REPO_ROOT } from '../../util/paths';

export const STELLARIUM_SKYCULTURE_JSON = resolve(
  REPO_ROOT,
  'data/stellarium/stellarium-modern-skyculture.json',
);

export const CONSTELLATIONS: { code: string; name: string }[] = [
  { code: 'And', name: 'Andromeda' },
  { code: 'Ant', name: 'Antlia' },
  { code: 'Aps', name: 'Apus' },
  { code: 'Aql', name: 'Aquila' },
  { code: 'Aqr', name: 'Aquarius' },
  { code: 'Ara', name: 'Ara' },
  { code: 'Ari', name: 'Aries' },
  { code: 'Aur', name: 'Auriga' },
  { code: 'Boo', name: 'Boötes' },
  { code: 'Cae', name: 'Caelum' },
  { code: 'Cam', name: 'Camelopardalis' },
  { code: 'Cap', name: 'Capricornus' },
  { code: 'Car', name: 'Carina' },
  { code: 'Cas', name: 'Cassiopeia' },
  { code: 'Cen', name: 'Centaurus' },
  { code: 'Cep', name: 'Cepheus' },
  { code: 'Cet', name: 'Cetus' },
  { code: 'Cha', name: 'Chamaeleon' },
  { code: 'Cir', name: 'Circinus' },
  { code: 'CMa', name: 'Canis Major' },
  { code: 'CMi', name: 'Canis Minor' },
  { code: 'Cnc', name: 'Cancer' },
  { code: 'Col', name: 'Columba' },
  { code: 'Com', name: 'Coma Berenices' },
  { code: 'CrA', name: 'Corona Australis' },
  { code: 'CrB', name: 'Corona Borealis' },
  { code: 'Crt', name: 'Crater' },
  { code: 'Cru', name: 'Crux' },
  { code: 'Crv', name: 'Corvus' },
  { code: 'CVn', name: 'Canes Venatici' },
  { code: 'Cyg', name: 'Cygnus' },
  { code: 'Del', name: 'Delphinus' },
  { code: 'Dor', name: 'Dorado' },
  { code: 'Dra', name: 'Draco' },
  { code: 'Equ', name: 'Equuleus' },
  { code: 'Eri', name: 'Eridanus' },
  { code: 'For', name: 'Fornax' },
  { code: 'Gem', name: 'Gemini' },
  { code: 'Gru', name: 'Grus' },
  { code: 'Her', name: 'Hercules' },
  { code: 'Hor', name: 'Horologium' },
  { code: 'Hya', name: 'Hydra' },
  { code: 'Hyi', name: 'Hydrus' },
  { code: 'Ind', name: 'Indus' },
  { code: 'Lac', name: 'Lacerta' },
  { code: 'Leo', name: 'Leo' },
  { code: 'Lep', name: 'Lepus' },
  { code: 'Lib', name: 'Libra' },
  { code: 'LMi', name: 'Leo Minor' },
  { code: 'Lup', name: 'Lupus' },
  { code: 'Lyn', name: 'Lynx' },
  { code: 'Lyr', name: 'Lyra' },
  { code: 'Men', name: 'Mensa' },
  { code: 'Mic', name: 'Microscopium' },
  { code: 'Mon', name: 'Monoceros' },
  { code: 'Mus', name: 'Musca' },
  { code: 'Nor', name: 'Norma' },
  { code: 'Oct', name: 'Octans' },
  { code: 'Oph', name: 'Ophiuchus' },
  { code: 'Ori', name: 'Orion' },
  { code: 'Pav', name: 'Pavo' },
  { code: 'Peg', name: 'Pegasus' },
  { code: 'Per', name: 'Perseus' },
  { code: 'Phe', name: 'Phoenix' },
  { code: 'Pic', name: 'Pictor' },
  { code: 'PsA', name: 'Piscis Austrinus' },
  { code: 'Psc', name: 'Pisces' },
  { code: 'Pup', name: 'Puppis' },
  { code: 'Pyx', name: 'Pyxis' },
  { code: 'Ret', name: 'Reticulum' },
  { code: 'Scl', name: 'Sculptor' },
  { code: 'Sco', name: 'Scorpius' },
  { code: 'Sct', name: 'Scutum' },
  { code: 'Ser', name: 'Serpens' },
  { code: 'Sex', name: 'Sextans' },
  { code: 'Sge', name: 'Sagitta' },
  { code: 'Sgr', name: 'Sagittarius' },
  { code: 'Tau', name: 'Taurus' },
  { code: 'Tel', name: 'Telescopium' },
  { code: 'TrA', name: 'Triangulum Australe' },
  { code: 'Tri', name: 'Triangulum' },
  { code: 'Tuc', name: 'Tucana' },
  { code: 'UMa', name: 'Ursa Major' },
  { code: 'UMi', name: 'Ursa Minor' },
  { code: 'Vel', name: 'Vela' },
  { code: 'Vir', name: 'Virgo' },
  { code: 'Vol', name: 'Volans' },
  { code: 'Vul', name: 'Vulpecula' },
];

if (CONSTELLATIONS.length !== 88) {
  throw new Error(`Expected 88 constellations, got ${CONSTELLATIONS.length}`);
}

export const CON_INDEX: Map<string, number> = new Map(
  CONSTELLATIONS.map((c, i) => [c.code.toLowerCase(), i])
);

// HIPs that Stellarium's modern sky culture references but the underlying
// catalog does not carry 3D positions for. Every entry must include a
// human-readable reason so a future audit can decide whether upstream data
// has been fixed. `buildFigureLines` silently skips these; any other
// unmatched HIP is a hard build error.
export const KNOWN_MISSING_HIPS: Map<number, string> = new Map([
  [5165, 'β Phoenicis (HD 6595) — parked refused_no_defensible_parallax; reinstates when Gaia DR4 fits the blend'],
  [89341, 'μ Sagittarii (Polis, HD 166937) — parked refused_no_defensible_parallax; same'],
]);

const IAU_EDGES_EPOCH = 'B1875';
const IAU_EDGES_SOURCE = 'https://pbarbier.com/constellations/edges_18.txt';

// The `edges` block of Stellarium's modern sky culture: the 781 IAU
// (Delporte 1930) boundary segments at equinox B1875, parsed by
// `src/client/constellation-boundaries/iau-geometry/iau-boundaries-pure.ts`.
export function readIauEdgeRecords(
  srcStellariumPath: string = STELLARIUM_SKYCULTURE_JSON,
): string[] {
  const raw = JSON.parse(readFileSync(srcStellariumPath, 'utf8'));
  const edges: unknown = raw.edges;
  if (!Array.isArray(edges) || edges.length === 0) {
    throw new Error(`Stellarium sky culture carries no edges array: ${srcStellariumPath}`);
  }
  if (raw.edges_epoch !== IAU_EDGES_EPOCH) {
    throw new Error(
      `Stellarium edges are at epoch ${raw.edges_epoch}, expected ${IAU_EDGES_EPOCH} — the `
      + 'boundary assignment precesses positions to that equinox before testing against them.',
    );
  }
  // A different upstream table can share the epoch while differing in side
  // conventions or segment count, both of which the region walk depends on.
  if (raw.edges_source !== IAU_EDGES_SOURCE) {
    throw new Error(
      `Stellarium edges came from ${raw.edges_source}, expected ${IAU_EDGES_SOURCE}`,
    );
  }
  if (!edges.every((record): record is string => typeof record === 'string')) {
    throw new Error(`Stellarium edges array holds a non-string record: ${srcStellariumPath}`);
  }
  return edges;
}

/** IAU-positional membership in the `CONSTELLATIONS` index space. */
export interface ConstellationAssignment {
  /** Index into `CONSTELLATIONS` for an equatorial Cartesian position. The
   *  boundaries partition the whole sphere, so this always resolves — there
   *  is no unclassified direction and no sentinel return. */
  indexAt(x: number, y: number, z: number): number;
  /** The bound lookup this wraps. Exposed so the boundary artifact draws its
   *  arcs and measures its nearest-wall distances against the same
   *  decomposition byte 34 was resolved from, rather than building a second
   *  one from the same file. */
  readonly lookup: IauConstellationLookup;
}

/** Binds the boundary lookup to the IAU-88 table's indices. The origin has no
 *  direction, so `indexAt` throws there rather than answering for Sol. */
export function createConstellationAssignment(
  records: readonly string[] = readIauEdgeRecords(),
): ConstellationAssignment {
  const lookup = createIauConstellationLookup(records);
  // The edge set and the table above are independent sources: a region naming
  // a constellation the table doesn't carry would ship the sentinel over a
  // real patch of sky.
  const unmapped = [...new Set(lookup.grid.cellCon)]
    .filter((code) => !CON_INDEX.has(constellationKey(code)));
  if (unmapped.length) {
    throw new Error(
      `IAU boundary regions absent from the IAU-88 table: ${unmapped.join(', ')}`,
    );
  }
  return {
    lookup,
    indexAt(x, y, z) {
      const norm = Math.hypot(x, y, z);
      if (norm === 0) {
        throw new Error('The origin has no sky direction to assign a constellation from');
      }
      const key = lookup.keyAt(
        raDecFromUnitVector({ x: x / norm, y: y / norm, z: z / norm }),
      );
      return CON_INDEX.get(key)!;
    },
  };
}

// Extracts classical stick-figure lines per IAU constellation from
// Stellarium's modern sky culture `index.json`. Each polyline in the source
// is a list of HIP integers; we resolve each HIP to a record index via
// `hipToIndex`. Missing HIPs are a hard error unless in KNOWN_MISSING_HIPS —
// the whole point of using Stellarium data (vs. fuzzy RA/Dec match) is
// deterministic mapping.
export function buildFigureLines(
  srcStellariumPath: string,
  hipToIndex: Map<number, number>,
): Map<number, number[][]> {
  const raw = JSON.parse(readFileSync(srcStellariumPath, 'utf8'));
  const source: Array<{ id: string; lines?: number[][] }> = raw.constellations ?? [];

  const out = new Map<number, number[][]>();
  const missing: Array<{ code: string; hip: number }> = [];

  for (const entry of source) {
    if (!entry.lines || entry.lines.length === 0) continue;
    const parts = entry.id.split(/\s+/);
    const code = parts[parts.length - 1];
    const conIndex = CON_INDEX.get(code.toLowerCase());
    if (conIndex === undefined) {
      throw new Error(`Stellarium constellation code not in IAU-88 table: ${code}`);
    }

    const resolved: number[][] = [];
    for (const polyline of entry.lines) {
      const starIndices: number[] = [];
      for (const hip of polyline) {
        const idx = hipToIndex.get(hip);
        if (idx === undefined) {
          if (!KNOWN_MISSING_HIPS.has(hip)) missing.push({ code, hip });
          continue;
        }
        starIndices.push(idx);
      }
      if (starIndices.length >= 2) resolved.push(starIndices);
    }
    if (resolved.length) out.set(conIndex, resolved);
  }

  if (missing.length) {
    const sample = missing.slice(0, 10).map((m) => `${m.code}/HIP ${m.hip}`);
    throw new Error(
      `Stellarium figures reference ${missing.length} HIP(s) not found in catalog and not in KNOWN_MISSING_HIPS. ` +
        `First ${sample.length}: ${sample.join(', ')}. ` +
        `If this is expected, add each HIP to KNOWN_MISSING_HIPS with a justification; otherwise investigate the data mismatch.`,
    );
  }

  return out;
}
