# Planet texture sources

Frozen originals, downloaded 2026-07-18 unless a row states
otherwise, plus two authored ring tables compiled from the literature.
Consumed only by `scripts/textures/build-textures.py`. JPEGs and TIFFs
ride LFS (`data/textures/src/*.jpg`, `*.tif` in `.gitattributes`); the
ring-profile text tables are small and stay on regular git.

| File | Body | Source & credit | License | URL |
|---|---|---|---|---|
| `mercury-pia15063.jpg` | Mercury | MESSENGER MDIS global mosaic (PIA15063, 6132×3066 grayscale), NASA/JHU-APL/Carnegie | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA15063 |
| `venus-bjj.jpg` | Venus (cloud deck) | Galileo 1990 flyby UV cloud mosaic (1800×900), map by Björn Jónsson | Free use with attribution (https://bjj.mmedia.is/acknow.html) | https://bjj.mmedia.is/data/venus/venus.html |
| `earth-blue-marble-2002.jpg` | Earth (day) | The Blue Marble, 2002 (land + ocean colour + sea ice + clouds composite, 2048×1024), NASA Earth Observatory / MODIS, downloaded 2026-07-19 | Public domain | https://visibleearth.nasa.gov/images/57735 |
| `mars-viking-mdim21.jpg` | Mars | USGS Viking MDIM 2.1 colorized global mosaic, 1 km/px browse (21339×10670), NASA/USGS/AMES | Public domain | https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m |
| `jupiter-pia07782.jpg` | Jupiter | Cassini Dec 2000 flyby cylindrical map (PIA07782, 3601×1801), NASA/JPL/Space Science Institute | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA07782 |
| `saturn-bjj.jpg` | Saturn | Southern hemisphere from 56 Cassini images (Sep 2004); northern hemisphere from 31 Voyager 2 images, via the author's own 2002 Voyager map (2880×1440), map by Björn Jónsson. **Both hemispheres are real imagery, 23 yr apart** — nothing is mirrored. Green channel is synthesised from the other filters (Cassini carried no green filter) | Free use with attribution | https://bjj.mmedia.is/data/saturn/index.html |
| `neptune-bjj.jpg` | Neptune | Voyager 2 Aug 1989 mosaic (1800×900), map by Björn Jónsson. North of ~50°N is reconstructed (no Voyager coverage); depicts 1989 appearance — the Great Dark Spot has since dissipated | Free use with attribution | https://bjj.mmedia.is/data/neptune/index.html |
| `pluto-pia11707.jpg` | Pluto | New Horizons LORRI/MVIC global mosaic (PIA11707, 5926×2963), NASA/JHU-APL/SwRI. Black band = un-imaged southern hemisphere (real data gap, kept) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA11707 |
| `rings-color-bjj.txt` | Saturn rings | Radial colour profile, 13 177 samples spanning 74 510–140 390 km, from Voyager + Cassini data by Björn Jónsson | Free use with attribution | https://bjj.mmedia.is/data/s_rings/index.html |
| `rings-transparency-bjj.txt` | Saturn rings | Radial transparency profile, same sampling/span (1 = no ring material) | Free use with attribution | https://bjj.mmedia.is/data/s_rings/index.html |
| `moon-lroc-svs.tif` | Moon | NASA SVS CGI Moon Kit colour map (LRO LROC WAC, 2048×1024), NASA's Scientific Visualization Studio. Retrieved 2026-07-19 | Public domain | https://svs.gsfc.nasa.gov/4720 |
| `io-usgs-clrmerge.jpg` | Io | USGS "Io Galileo SSI / Voyager Color Merged Global Mosaic 1km", 4096-px browse reduction made at retrieval 2026-07-19 (full 11445×5723 GeoTIFF is 189 MB), NASA/JPL/USGS. PDS label: PositiveWest, centre 0° — build flips to positive-east | Public domain | https://astrogeology.usgs.gov/search/map/io_galileo_ssi_voyager_color_merged_global_mosaic_1km |
| `europa-usgs-global.jpg` | Europa | USGS "Europa Voyager - Galileo SSI Global Mosaic 500m" (grayscale), 4096-px browse reduction made at retrieval 2026-07-19, NASA/JPL/USGS. PositiveWest, centre 180° — build flips | Public domain | https://astrogeology.usgs.gov/search/map/europa_voyager_galileo_ssi_global_mosaic_500m |
| `ganymede-usgs-clr.jpg` | Ganymede | USGS "Ganymede Voyager - Galileo SSI Global Color Mosaic 1435m" (Kersten et al. 2021), 4096-px browse reduction made at retrieval 2026-07-19, NASA/JPL/USGS/DLR. PositiveEast, centre 180° | Public domain | https://astrogeology.usgs.gov/search/map/Ganymede/Voyager-Galileo/Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m |
| `callisto-usgs-global.jpg` | Callisto | USGS "Callisto Voyager - Galileo SSI Global Mosaic 1km" (grayscale), 4096-px browse reduction made at retrieval 2026-07-19, NASA/JPL/USGS. PositiveWest, centre 180° — build flips | Public domain | https://astrogeology.usgs.gov/search/map/callisto_voyager_galileo_ssi_global_mosaic_1km |
| `mimas-pia18437.jpg` | Mimas | Cassini ISS global colour mosaic (PIA18437, Schenk/LPI 2014 series, IR-G-UV enhanced colour), NASA/JPL-Caltech/SSI/LPI. Retrieved 2026-07-19 | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18437 |
| `enceladus-pia18435.jpg` | Enceladus | Cassini ISS global colour mosaic (PIA18435, same series) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18435 |
| `tethys-pia18439.jpg` | Tethys | Cassini ISS global colour mosaic (PIA18439, same series) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18439 |
| `dione-pia18434.jpg` | Dione | Cassini ISS global colour mosaic (PIA18434, same series) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18434 |
| `rhea-pia18438.jpg` | Rhea | Cassini ISS global colour mosaic (PIA18438, same series) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18438 |
| `titan-iss-p19658.tif` | Titan | USGS "Titan ISS PIA19658 Global Mosaic 4km" (938 nm surface mosaic behind the haze, grayscale, 4040×2020), NASA/JPL/USGS. PositiveWest, centre 180° — build flips. Retrieved 2026-07-19 | Public domain | https://astrogeology.usgs.gov/search/map/Titan/Cassini/Global-Mosaic/Titan_ISS_P19658_Mosaic_Global_4km |
| `iapetus-pia18436.jpg` | Iapetus | Cassini ISS global colour mosaic (PIA18436, same 2014 series) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18436 |
| `triton-pia18668.jpg` | Triton | Voyager 2 global colour mosaic (PIA18668, Schenk/LPI 2014). Black region = un-imaged northern hemisphere (real data gap) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18668 |
| `rings-uranus.tsv` | Uranus rings | Authored table (not a download), values compiled 2026-07-18: the 10 narrow main rings' mid radii, mean widths and mid-range normal optical depths from the Earth-based + Voyager 2 occultation canon (French, Nicholson, Porco & Elliot 1991, in *Uranus*, Univ. of Arizona Press) | n/a (measured values) | https://ui.adsabs.harvard.edu/abs/1986Icar...67..134F/abstract |
| `rings-neptune.tsv` | Neptune rings | Authored table (not a download), values compiled 2026-07-18: Galle/Le Verrier/Lassell/Arago/Adams radii, widths and normal optical depths from Voyager 2 + stellar occultations (Porco et al. 1995, in *Neptune and Triton*, Univ. of Arizona Press); Adams τ is the azimuthal average folding in its arcs | n/a (measured values) | https://ui.adsabs.harvard.edu/abs/1995Icar..113..295N/abstract |
| `moon-dem-svs.tif` | Moon (relief) | NASA SVS CGI Moon Kit `ldem_64_uint.tif` (LRO LOLA, 23040×11520 uint16), 4096-px area-average reduction made at retrieval 2026-08-16 from the 506 MB original. **Carries NO GDAL scale tag and is NOT metres** — samples are half-metres above a 1727400 m datum; the published LOLA span −9110…+10760 m is the check. Centre 0°E, positive-east | Public domain | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_64_uint.tif |
| `mercury-dem-messenger.tif` | Mercury (relief) | USGS MESSENGER Global DEM 665 m v2 (23040×11520 int16, GDAL `SCALE` 0.5, nodata −32768, sphere radius 2439400 m), 4096-px area-average reduction made at retrieval 2026-08-16 from the 506 MB original. **Centre 180°E** — unlike its colour map, so the build rolls it | Public domain | https://planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif |
| `mars-dem-mola.tif` | Mars (relief) | USGS MGS MOLA DEM 463 m global mosaic (46080×23040 int16 metres, no scale tag, nodata −32768), 4096-px area-average reduction made at retrieval 2026-08-16 from the 2.0 GB original. Centre 0°E, positive-east | Public domain | https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif |

Venus is deliberately the **cloud deck**, not the Magellan radar
surface — the physically honest naked-eye appearance (2f6.6 design
record). Uranus has no source file: it ships texture-less by design.
The five Uranian moons also have no source: Voyager imaged their
southern hemispheres only, and a half-empty map reads worse than the
clean representative-colour spheroid.

The three USGS `*-usgs-*.jpg` files are 4096-px LANCZOS/JPEG-92
reductions of 115–199 MB GeoTIFF mosaics, produced once at retrieval —
the runtime artifact caps at 2048 px, so freezing the full GeoTIFFs
would spend hundreds of LFS megabytes on resolution the pipeline can
never use (the same trade the Mars row makes by freezing the 1 km/px
browse). The refresh recipe below re-derives them from the linked
originals.

The three `*-dem-*.tif` rows make the same trade against 0.5–2.0 GB
originals, and are stored as **uint16 metres biased by 32768** — a
signed elevation in a format every tool reads back identically.
Reducing to the pipeline's width is area-average, never LANCZOS: a
DEM must not ring, because overshoot at a crater rim becomes a slope
that isn't there. Both USGS DEMs are int16 in one strip per row, which
Pillow mis-decodes as int32 mode `I`; `reduce_dem.py` reads the strip
block directly and asserts the decoded elevation span against the
published one, so a missed scale tag fails loudly instead of shipping
doubled slopes.

## Refresh recipe

These are one-shot frozen snapshots, not a `scripts/refresh/`
pipeline. To upgrade a body: download a better map (vet the license,
prefer NASA/USGS PD), replace the file here, update the table row and
the `BODIES` map in `scripts/textures/build-textures.py`, rerun
`pnpm run build:textures`, and commit both layers.

For a **DEM**, download the original from its row's URL and run
`python3 scripts/textures/reduce_dem.py <body> <downloaded.tif>` — it
writes the frozen reduction here at the width `dem_relief.py` declares.
Raising that width (the Moon at 8192 once block compression lands) is a
re-pull, not a resize: the frozen file carries no headroom, by the same
trade the rows above make. Add a body by giving it a `DEM_BODIES` entry
carrying its decode, its no-data sentinel, both map centres, and its
drawn radius.

**Budget memory for it.** `reduce_dem.py` converts the whole mosaic to
float32 in one array before resampling — 4.2 GB for the 46080×23040
MOLA grid, and Pillow's resize holds its own copy — so the Mars run
wants something like 8 GB free on top of the 2.0 GB download. It is
one-shot and run by hand, which is why it is written for clarity rather
than tiled to a fixed memory ceiling.

NASA Photojournal full-res assets live at
`https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia<NN>/pia<NNNNN>/PIA<NNNNN>.jpg`
(the old `photojournal.jpl.nasa.gov/jpeg/…` pattern now serves HTML).
