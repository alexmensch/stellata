# Planet texture sources

Frozen originals, downloaded 2026-07-18 (retrieval date for every
row). Consumed only by `scripts/textures/build-textures.py`. JPEGs
ride LFS (`data/textures/src/*.jpg` in `.gitattributes`); the two
ring-profile text tables are small and stay on regular git.

| File | Body | Source & credit | License | URL |
|---|---|---|---|---|
| `mercury-pia15063.jpg` | Mercury | MESSENGER MDIS global mosaic (PIA15063, 6132×3066 grayscale), NASA/JHU-APL/Carnegie | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA15063 |
| `venus-bjj.jpg` | Venus (cloud deck) | Galileo 1990 flyby UV cloud mosaic (1800×900), map by Björn Jónsson | Free use with attribution (https://bjj.mmedia.is/acknow.html) | https://bjj.mmedia.is/data/venus/venus.html |
| `earth-bmng.jpg` | Earth (day) | Blue Marble Next Generation, Dec 2004 (5400×2700), NASA Earth Observatory | Public domain | https://visibleearth.nasa.gov/images/73909 |
| `earth-night.jpg` | Earth (night) | Black Marble 2016 (3600×1800), NASA Earth Observatory / Suomi NPP VIIRS | Public domain | https://earthobservatory.nasa.gov/features/NightLights |
| `mars-viking-mdim21.jpg` | Mars | USGS Viking MDIM 2.1 colorized global mosaic, 1 km/px browse (21339×10670), NASA/USGS/AMES | Public domain | https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m |
| `jupiter-pia07782.jpg` | Jupiter | Cassini Dec 2000 flyby cylindrical map (PIA07782, 3601×1801), NASA/JPL/Space Science Institute | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA07782 |
| `saturn-bjj.jpg` | Saturn | Cassini Sep 2004 southern-hemisphere mosaic, mirrored north (2880×1440), map by Björn Jónsson | Free use with attribution | https://bjj.mmedia.is/data/saturn/index.html |
| `neptune-bjj.jpg` | Neptune | Voyager 2 Aug 1989 mosaic (1800×900), map by Björn Jónsson. North of ~50°N is reconstructed (no Voyager coverage); depicts 1989 appearance — the Great Dark Spot has since dissipated | Free use with attribution | https://bjj.mmedia.is/data/neptune/index.html |
| `pluto-pia11707.jpg` | Pluto | New Horizons LORRI/MVIC global mosaic (PIA11707, 5926×2963), NASA/JHU-APL/SwRI. Black band = un-imaged southern hemisphere (real data gap, kept) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA11707 |
| `rings-color-bjj.txt` | Saturn rings | Radial colour profile, 13 177 samples spanning 74 510–140 390 km, from Voyager + Cassini data by Björn Jónsson | Free use with attribution | https://bjj.mmedia.is/data/s_rings/index.html |
| `rings-transparency-bjj.txt` | Saturn rings | Radial transparency profile, same sampling/span (1 = no ring material) | Free use with attribution | https://bjj.mmedia.is/data/s_rings/index.html |

Venus is deliberately the **cloud deck**, not the Magellan radar
surface — the physically honest naked-eye appearance (2f6.6 design
record). Uranus has no source file: it ships texture-less by design.

## Refresh recipe

These are one-shot frozen snapshots, not a `scripts/refresh/`
pipeline. To upgrade a body: download a better map (vet the license,
prefer NASA/USGS PD), replace the file here, update the table row and
the `BODIES` map in `scripts/textures/build-textures.py`, rerun
`pnpm run build:textures`, and commit both layers. NASA Photojournal
full-res assets live at
`https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia<NN>/pia<NNNNN>/PIA<NNNNN>.jpg`
(the old `photojournal.jpl.nasa.gov/jpeg/…` pattern now serves HTML).
