// Gaia DR3 ↔ classical-catalog cross-walks (currently HIP, with room
// for TYC) used by the catalog builder to bridge GCVS / CCDM cross-IDs
// onto gaia_source_id anchors. Same shape as scripts/binaries/parsers.py
// parse_gaia_hip_xmatch — many-to-one collisions keep the nearest match.
import { readFileSync } from 'node:fs';

const HIP_COL = 'hip';
const GAIA_COL = 'gaia_source_id';
const ANG_COL = 'angular_distance';

export function parseGaiaHipXmatchTsv(text: string): Map<number, string> {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return new Map();
  const header = lines[0].split('\t');
  const hipIdx = header.indexOf(HIP_COL);
  const gaiaIdx = header.indexOf(GAIA_COL);
  const angIdx = header.indexOf(ANG_COL);
  if (hipIdx < 0 || gaiaIdx < 0) {
    throw new Error(
      `gaia_dr3_hip_xmatch.tsv: expected columns ${HIP_COL} + ${GAIA_COL} in header`,
    );
  }
  const best = new Map<number, { ang: number; src: string }>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const fields = line.split('\t');
    const hipRaw = fields[hipIdx];
    const gaiaRaw = fields[gaiaIdx];
    if (!hipRaw || !gaiaRaw) continue;
    const hip = Number.parseInt(hipRaw, 10);
    if (!Number.isFinite(hip) || hip <= 0) continue;
    if (!/^\d+$/.test(gaiaRaw)) continue;
    let ang = Number.POSITIVE_INFINITY;
    if (angIdx >= 0 && fields[angIdx]) {
      const parsed = Number.parseFloat(fields[angIdx]);
      if (Number.isFinite(parsed)) ang = parsed;
    }
    const prev = best.get(hip);
    if (!prev || ang < prev.ang) best.set(hip, { ang, src: gaiaRaw });
  }
  const out = new Map<number, string>();
  for (const [hip, { src }] of best) out.set(hip, src);
  return out;
}

export function readGaiaHipXmatch(path: string): Map<number, string> {
  return parseGaiaHipXmatchTsv(readFileSync(path, 'utf8'));
}
