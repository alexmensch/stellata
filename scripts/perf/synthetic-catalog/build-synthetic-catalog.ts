// `pnpm run perf:synthetic` — rewrites a catalog artifact set with a synthetic
// faint population appended, so wire size and GPU memory can be measured at a
// deeper magnitude floor today. README.md is the contract.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import * as THREE from 'three';

import {
  APSIS_FIELDS,
  CATALOG_MANIFEST_FILENAME,
  HEADER_SIZE,
  MULTIPLICITY_SINGLE,
  NO_APSIS,
  NO_COMPANION,
  NO_CONSTELLATION_INDEX,
  NO_GAIA_SOURCE_ID,
  RECORD_SIZE,
  assembleCatalogChunks,
  catalogChunkFilename,
  planCatalogChunks,
  readCatalogHeader,
  readRecordField,
  writeCatalogHeader,
  writeStarRecord,
  type ApsisField,
  type CatalogManifest,
} from '../../catalog/record/catalog-pure';
import { GAL_TO_ICRS } from '../../../src/client/galactic/galactic-coords';
import { DISC_RADIUS_PC } from '../../../src/client/milkyway/milkyway-column-pure';
import {
  GAIA_CENSUS_BY_G,
  buildIntrinsicPool,
  distanceModulus,
  drawTupleBrighterThan,
  equalAreaSkyGrid,
  galacticUnitVector,
  marchSightline,
  marchStepPc,
  mulberry32,
  sampleCdf,
  sightlineWeights,
  skyCellSolidAngle,
  toCdf,
  type IntrinsicTuple,
  type SightlineStep,
} from './synthetic-catalog-pure';

const N_LON = 128;
const N_SIN_B = 64;
const RADIAL_STEPS = 192;
const POOL_MAX_DIST_PC = 100;
const MIN_SYNTHETIC_DIST_PC = 50;
const DRAW_ATTEMPTS_PER_RECORD = 8;
/** ~30 km/s in pc/yr, the disc's velocity dispersion. */
const VELOCITY_SIGMA_PC_PER_YR = 3.07e-5;

const NO_APSIS_BLOCK = Object.fromEntries(
  APSIS_FIELDS.map((f) => [f, NO_APSIS]),
) as Record<ApsisField, number>;

interface RealRecordView {
  readonly xPc: number;
  readonly yPc: number;
  readonly zPc: number;
  readonly absMag: number;
  readonly distPc: number;
  readonly conIndex: number;
}

function readSourceCatalog(dir: string): { buffer: ArrayBuffer; manifest: CatalogManifest } {
  const manifest = JSON.parse(
    readFileSync(join(dir, CATALOG_MANIFEST_FILENAME), 'utf8'),
  ) as CatalogManifest;
  const chunks = manifest.chunkBytes.map((_, i) =>
    new Uint8Array(readFileSync(join(dir, catalogChunkFilename(i)))),
  );
  return { buffer: assembleCatalogChunks(chunks, manifest), manifest };
}

function decodeReal(view: DataView, count: number): RealRecordView[] {
  const out: RealRecordView[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const off = HEADER_SIZE + i * RECORD_SIZE;
    const xPc = readRecordField(view, off, 'x');
    const yPc = readRecordField(view, off, 'y');
    const zPc = readRecordField(view, off, 'z');
    out[i] = {
      xPc,
      yPc,
      zPc,
      absMag: readRecordField(view, off, 'absmag'),
      distPc: Math.hypot(xPc, yPc, zPc),
      conIndex: readRecordField(view, off, 'conIndex'),
    };
  }
  return out;
}

function buildPool(view: DataView, real: readonly RealRecordView[]): IntrinsicTuple[] {
  const tuples: IntrinsicTuple[] = [];
  for (let i = 0; i < real.length; i++) {
    const r = real[i];
    if (r.distPc <= 0 || r.distPc > POOL_MAX_DIST_PC) continue;
    if (!Number.isFinite(r.absMag)) continue;
    const off = HEADER_SIZE + i * RECORD_SIZE;
    tuples.push({
      absMag: r.absMag,
      ci: readRecordField(view, off, 'ci'),
      physRadius: readRecordField(view, off, 'physRadius'),
      spectClass: readRecordField(view, off, 'spectClass'),
      lumClass: readRecordField(view, off, 'lumClass'),
    });
  }
  return tuples;
}

function cellIndexFor(lRad: number, bRad: number): number {
  const l = ((lRad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const i = Math.min(N_LON - 1, Math.floor((l / (2 * Math.PI)) * N_LON));
  const j = Math.min(N_SIN_B - 1, Math.floor(((Math.sin(bRad) + 1) / 2) * N_SIN_B));
  return j * N_LON + i;
}

/** Modal constellation per sky cell, so a synthetic star inherits a plausible
 *  positional constellation without re-running the IAU boundary resolve.
 *  Indexed in `equalAreaSkyGrid(N_LON, N_SIN_B)` order, so a sampled cell
 *  index addresses it directly. */
function constellationByCell(
  real: readonly RealRecordView[],
  icrsToGal: THREE.Matrix3,
): Int16Array {
  const counts = new Map<number, Map<number, number>>();
  const v = new THREE.Vector3();
  for (const r of real) {
    if (r.distPc <= 0 || r.conIndex === NO_CONSTELLATION_INDEX) continue;
    v.set(r.xPc, r.yPc, r.zPc).normalize().applyMatrix3(icrsToGal);
    const cell = cellIndexFor(
      Math.atan2(v.y, v.x),
      Math.asin(Math.max(-1, Math.min(1, v.z))),
    );
    let m = counts.get(cell);
    if (m === undefined) {
      m = new Map();
      counts.set(cell, m);
    }
    m.set(r.conIndex, (m.get(r.conIndex) ?? 0) + 1);
  }
  const out = new Int16Array(N_LON * N_SIN_B).fill(-1);
  for (const [cell, m] of counts) {
    let best = -1;
    let bestN = 0;
    for (const [con, n] of m) {
      if (n > bestN) {
        best = con;
        bestN = n;
      }
    }
    out[cell] = best;
  }
  return out;
}

function gaussian(rng: () => number): number {
  const u = Math.max(Number.EPSILON, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function main(): void {
  const { values } = parseArgs({
    options: {
      'limit-mag': { type: 'string', default: '11' },
      seed: { type: 'string', default: '1' },
      source: { type: 'string' },
      out: { type: 'string' },
      'max-records': { type: 'string' },
    },
  });

  const limitMag = Number(values['limit-mag']);
  const seed = Number(values.seed);
  const sourceDir = values.source;
  const outDir = values.out;
  if (sourceDir === undefined || outDir === undefined) {
    throw new Error('--source <dir> and --out <dir> are required');
  }
  const census = GAIA_CENSUS_BY_G.get(limitMag);
  if (census === undefined) {
    throw new Error(
      `no census target for limit ${limitMag}; have ${[...GAIA_CENSUS_BY_G.keys()].join(', ')}`,
    );
  }

  const { buffer, manifest } = readSourceCatalog(sourceDir);
  const view = new DataView(buffer);
  const header = readCatalogHeader(buffer);
  console.log(`source: ${header.count} records, ${buffer.byteLength} bytes`);

  const real = decodeReal(view, header.count);
  const pool = buildIntrinsicPool(buildPool(view, real));
  console.log(`intrinsic pool: ${pool.tuples.length} records within ${POOL_MAX_DIST_PC} pc`);

  const icrsToGal = new THREE.Matrix3().setFromMatrix4(GAL_TO_ICRS).transpose();
  const conByCell = constellationByCell(real, icrsToGal);

  const alreadyAtLimit = real.filter(
    (r) => r.distPc > 0 && r.absMag + distanceModulus(r.distPc) <= limitMag,
  ).length;
  const cap =
    values['max-records'] !== undefined
      ? Number(values['max-records'])
      : census - alreadyAtLimit;
  const wanted = Math.max(0, cap);
  console.log(
    `census at G<=${limitMag}: ${census}; real records at V<=${limitMag} ` +
      `unextincted: ${alreadyAtLimit}; synthesising ${wanted}`,
  );

  const cells = equalAreaSkyGrid(N_LON, N_SIN_B);
  const solidAngle = skyCellSolidAngle(N_LON, N_SIN_B);
  const cellCdfs: number[][] = [];
  const cellTotals: number[] = [];
  const cellMarches: SightlineStep[][] = [];
  for (const c of cells) {
    const dir = galacticUnitVector(c.lRad, c.bRad);
    const march = marchSightline(dir, DISC_RADIUS_PC, RADIAL_STEPS);
    const cdf = toCdf(
      sightlineWeights(march, pool, limitMag, solidAngle, MIN_SYNTHETIC_DIST_PC),
    );
    cellMarches.push(march);
    cellCdfs.push(cdf);
    cellTotals.push(cdf[cdf.length - 1]);
  }
  const skyCdf = toCdf(cellTotals);
  if (!(skyCdf[skyCdf.length - 1] > 0)) {
    throw new Error('no sightline carries weight — check the limit magnitude');
  }

  const rng = mulberry32(seed);
  const maxCount = header.count + wanted;
  const nameTable = new Uint8Array(
    buffer.slice(header.nameTableOffset, header.nameTableOffset + header.nameTableLength),
  );
  const outBuf = new ArrayBuffer(HEADER_SIZE + maxCount * RECORD_SIZE + nameTable.byteLength);
  const outView = new DataView(outBuf);

  new Uint8Array(outBuf).set(
    new Uint8Array(buffer, HEADER_SIZE, header.count * RECORD_SIZE),
    HEADER_SIZE,
  );

  let maxSid = 0;
  for (let i = 0; i < header.count; i++) {
    const sid = readRecordField(view, HEADER_SIZE + i * RECORD_SIZE, 'sid');
    if (sid > maxSid) maxSid = sid;
  }

  const galToIcrs = new THREE.Matrix3().setFromMatrix4(GAL_TO_ICRS);
  const p = new THREE.Vector3();
  const dStep = marchStepPc(cellMarches[0]);
  const attemptBudget = (wanted + 1) * DRAW_ATTEMPTS_PER_RECORD;
  let written = 0;
  let rejected = 0;
  let attempts = 0;
  while (written < wanted) {
    if (++attempts > attemptBudget) {
      throw new Error(
        `draw budget exhausted at ${written}/${wanted} (${rejected} rejected) — ` +
          `check --limit-mag against the intrinsic pool`,
      );
    }
    const ci = sampleCdf(skyCdf, rng());
    if (ci < 0) break;
    const march = cellMarches[ci];
    const si = sampleCdf(cellCdfs[ci], rng());
    if (si < 0) {
      rejected++;
      continue;
    }
    const cell = cells[ci];

    const dLon = (2 * Math.PI * (rng() - 0.5)) / N_LON;
    const sinB = Math.max(
      -1,
      Math.min(1, Math.sin(cell.bRad) + (2 * (rng() - 0.5)) / N_SIN_B),
    );
    const dir = galacticUnitVector(cell.lRad + dLon, Math.asin(sinB));
    const distPc = Math.max(
      MIN_SYNTHETIC_DIST_PC,
      march[si].distPc + dStep * (rng() - 0.5),
    );

    const absMagMax = limitMag - distanceModulus(distPc) - march[si].extinctionMag;
    const tuple = drawTupleBrighterThan(pool, absMagMax, rng);
    if (tuple === null) {
      rejected++;
      continue;
    }

    p.set(dir[0] * distPc, dir[1] * distPc, dir[2] * distPc).applyMatrix3(galToIcrs);
    const con = conByCell[ci];
    writeStarRecord(outView, HEADER_SIZE + (header.count + written) * RECORD_SIZE, {
      x: p.x,
      y: p.y,
      z: p.z,
      vx: gaussian(rng) * VELOCITY_SIGMA_PC_PER_YR,
      vy: gaussian(rng) * VELOCITY_SIGMA_PC_PER_YR,
      vz: gaussian(rng) * VELOCITY_SIGMA_PC_PER_YR,
      absmag: tuple.absMag,
      ci: tuple.ci,
      physRadius: tuple.physRadius,
      companionIdx: NO_COMPANION,
      nameOffset: 0,
      spectClass: tuple.spectClass,
      lumClass: tuple.lumClass,
      conIndex: con >= 0 ? con : NO_CONSTELLATION_INDEX,
      flags: 0,
      ampUnits: 0,
      periodUnits: 0,
      varType: 0,
      hip: 0,
      gaiaSourceId: NO_GAIA_SOURCE_ID,
      apsis: NO_APSIS_BLOCK,
      sid: maxSid + 1 + written,
      multiplicityStatus: MULTIPLICITY_SINGLE,
    });
    written++;
  }

  const outCount = header.count + written;
  const nameTableOffset = HEADER_SIZE + outCount * RECORD_SIZE;
  const outBytes = nameTableOffset + nameTable.byteLength;
  new Uint8Array(outBuf).set(nameTable, nameTableOffset);
  writeCatalogHeader(outView, {
    count: outCount,
    nameTableOffset,
    nameTableLength: nameTable.byteLength,
  });

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) {
    if (/^catalog\.bin\.\d+$/.test(f)) rmSync(join(outDir, f));
  }
  const plan = planCatalogChunks(outBytes);
  let at = 0;
  plan.forEach((bytes, i) => {
    writeFileSync(join(outDir, catalogChunkFilename(i)), Buffer.from(outBuf, at, bytes));
    at += bytes;
  });
  writeFileSync(
    join(outDir, CATALOG_MANIFEST_FILENAME),
    JSON.stringify({ ...manifest, chunkBytes: plan, totalBytes: outBytes }),
  );

  console.log(
    `wrote ${outCount} records (${written} synthetic, ${rejected} rejected draws) ` +
      `in ${plan.length} chunks, ${outBytes} bytes`,
  );
}

main();
