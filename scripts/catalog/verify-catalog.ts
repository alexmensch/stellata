// Diagnostic CLI over the binary catalogue — header dump,
// brightest/dimmest rows, named-star sanity checks, Apsis coverage,
// variable-star samples, space-motion velocity coverage.

import { HEADER_SIZE, RECORD_SIZE } from './catalog-pure';
import { KM_S_TO_PC_YR, VELOCITY_SANITY_CEILING_KM_S } from './direction-cascade';
import {
  type CatalogRecord,
  distancePc,
  loadCatalog,
  lookupByName,
} from './catalog-lookup';

const catalog = await loadCatalog();
const { magic, version, count, nameTableOffset, nameTableLength } = catalog.header;

console.log(`magic=${magic} version=${version} count=${count} recordSize=${RECORD_SIZE}`);
console.log(`nameTableOffset=${nameTableOffset} nameTableLength=${nameTableLength}`);
console.log(`file size=${HEADER_SIZE + count * RECORD_SIZE + nameTableLength} (header+records+names)`);

console.log('\nBrightest 5 records (by absmag):');
for (let i = 0; i < 5; i++) console.log(catalog.record(i));

console.log('\nDimmest 3 records:');
for (let i = count - 3; i < count; i++) console.log(catalog.record(i));

console.log('\nSearch for Sirius / Sol / Betelgeuse / Rigil Kentaurus / Toliman:');
for (const target of ['Sirius', 'Sol', 'Betelgeuse', 'Rigil Kentaurus', 'Toliman']) {
  const r = lookupByName(catalog, target);
  if (r) console.log({ ...r, dist_pc: distancePc(r).toFixed(3) });
}

console.log('\nGaia DR3 Apsis coverage:');
{
  let matched = 0;
  let teffGspphot = 0;
  let teffGspspec = 0;
  let teffEither = 0;
  for (const r of catalog.records()) {
    const hasPhot = r.teffGspphot !== null;
    const hasSpec = r.teffGspspec !== null;
    if (hasPhot) teffGspphot++;
    if (hasSpec) teffGspspec++;
    if (hasPhot || hasSpec) teffEither++;
    if (hasPhot || hasSpec || r.loggGspphot !== null || r.loggGspspec !== null) {
      matched++;
    }
  }
  const pct = (n: number) => ((n / count) * 100).toFixed(1);
  console.log(`  any Apsis field: ${matched} / ${count} (${pct(matched)}%)`);
  console.log(`  Teff gspphot:    ${teffGspphot} / ${count} (${pct(teffGspphot)}%)`);
  console.log(`  Teff gspspec:    ${teffGspspec} / ${count} (${pct(teffGspspec)}%)`);
  console.log(`  Teff either:     ${teffEither} / ${count} (${pct(teffEither)}%)`);
}

console.log('\nSpace-motion velocity coverage:');
{
  let moving = 0;
  let fastest: CatalogRecord | null = null;
  let fastestSpeed = 0;
  for (const r of catalog.records()) {
    const speed = Math.hypot(r.vx, r.vy, r.vz); // pc/yr
    if (speed > 0) moving++;
    if (speed > fastestSpeed) {
      fastestSpeed = speed;
      fastest = r;
    }
  }
  const pct = ((moving / count) * 100).toFixed(1);
  console.log(`  non-zero velocity: ${moving} / ${count} (${pct}%)`);
  if (fastest) {
    console.log(
      `  fastest: ${fastest.name ?? `#${fastest.i}`} at ` +
      `${(fastestSpeed / KM_S_TO_PC_YR).toFixed(1)} km/s (${fastestSpeed.toExponential(3)} pc/yr)`,
    );
    // The build zeroes any velocity past the sanity ceiling, so a survivor
    // above it means the clamp regressed.
    if (fastestSpeed > VELOCITY_SANITY_CEILING_KM_S * KM_S_TO_PC_YR) {
      console.warn(
        `  WARNING: fastest velocity exceeds the ${VELOCITY_SANITY_CEILING_KM_S} km/s ` +
        `sanity ceiling — the build-time clamp did not apply`,
      );
    }
  }
}

console.log('\nVariable star count and 5 examples:');
let varCount = 0;
const varSamples: CatalogRecord[] = [];
for (const r of catalog.records()) {
  if (r.periodDays > 0) {
    varCount++;
    if (r.name && varSamples.length < 5) varSamples.push(r);
  }
}
console.log(`  ${varCount} variable stars`);
for (const r of varSamples) {
  console.log(`    ${r.name}: P=${r.periodDays.toFixed(2)}d, A=${r.amplitudeMag.toFixed(2)}mag (${r.conCode})`);
}
