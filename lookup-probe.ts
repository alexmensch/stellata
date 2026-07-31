import { DEFAULT_CATALOG_MANIFEST, loadCatalog, lookupByHip, distancePc } from './scripts/catalog/catalog-lookup';

const cat = await loadCatalog(DEFAULT_CATALOG_MANIFEST);
for (const hip of [78727, 43820, 55203]) {
  const r = lookupByHip(cat, hip);
  if (!r) { console.log(`HIP ${hip}: not found`); continue; }
  console.log(`HIP ${hip}: dist=${distancePc(r).toFixed(4)} absmag=${r.absmag.toFixed(3)} spectClass=${r.spectClass} lumClass=${r.lumClass} ci=${r.ci.toFixed(3)} radius=${r.physicalRadius.toFixed(3)} gaia=${r.gaiaSourceId} multiplicity=${r.multiplicityStatus}`);
}
