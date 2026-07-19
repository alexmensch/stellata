# Planet texture sources

Frozen originals, downloaded 2026-07-18 (retrieval date for every
row), plus two authored ring tables compiled from the literature.
Consumed only by `scripts/textures/build-textures.py`. JPEGs ride LFS
(`data/textures/src/*.jpg` in `.gitattributes`); the ring-profile
text tables are small and stay on regular git.

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

## Refresh recipe

These are one-shot frozen snapshots, not a `scripts/refresh/`
pipeline. To upgrade a body: download a better map (vet the license,
prefer NASA/USGS PD), replace the file here, update the table row and
the `BODIES` map in `scripts/textures/build-textures.py`, rerun
`pnpm run build:textures`, and commit both layers. NASA Photojournal
full-res assets live at
`https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia<NN>/pia<NNNNN>/PIA<NNNNN>.jpg`
(the old `photojournal.jpl.nasa.gov/jpeg/…` pattern now serves HTML).
