# Planet texture sources

Frozen originals, downloaded 2026-07-18 unless a row states
otherwise, plus two authored ring tables compiled from the literature.
Consumed only by `scripts/textures/build-textures.py`. JPEGs and TIFFs
ride LFS (`data/textures/src/*.jpg`, `*.tif` in `.gitattributes`); the
ring-profile text tables are small and stay on regular git.

**Every row states the dimensions of the file as frozen**, first, before
any dimensions of the original it was reduced from.
`source-provenance.test.ts` reads each file's own header and fails if the
row and the file disagree — the check that used to be "read the row and
believe it", which is how 3 of the first 6 rows checked stayed wrong.

| File | Body | Source & credit | License | URL |
|---|---|---|---|---|
| `mercury-pia15063.jpg` | Mercury | MESSENGER MDIS global mosaic (PIA15063, 6132×3066 grayscale, measured chroma 0.00), NASA/JHU-APL/Carnegie. All of its rendered colour comes from the index-anchored calibration gains, not from the source | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA15063 |
| `venus-bjj.jpg` | Venus (cloud deck) | Galileo 1990 flyby UV cloud mosaic (1800×900), map by Björn Jónsson | Free use with attribution (https://bjj.mmedia.is/acknow.html) | https://bjj.mmedia.is/data/venus/venus.html |
| `earth-blue-marble-2002.jpg` | Earth (day) | The Blue Marble, 2002 (land + ocean colour + sea ice + clouds composite, 2048×1024), NASA Earth Observatory / MODIS, downloaded 2026-07-19 | Public domain | https://visibleearth.nasa.gov/images/57735 |
| `mars-viking-mdim21.jpg` | Mars | USGS Viking MDIM 2.1 colorized global mosaic, 1 km/px browse (21339×10670), NASA/USGS/AMES | Public domain | https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m |
| `jupiter-pia07782.jpg` | Jupiter | Cassini Dec 2000 flyby cylindrical map (PIA07782, 3601×1801), NASA/JPL/Space Science Institute | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA07782 |
| `saturn-bjj.jpg` | Saturn | Southern hemisphere from 56 Cassini images (Sep 2004); northern hemisphere from 31 Voyager 2 images, via the author's own 2002 Voyager map (2880×1440), map by Björn Jónsson. **Both hemispheres are real imagery, 23 yr apart** — nothing is mirrored. Green channel is synthesised from the other filters (Cassini carried no green filter) | Free use with attribution | https://bjj.mmedia.is/data/saturn/index.html |
| `neptune-bjj.jpg` | Neptune | Voyager 2 Aug 1989 mosaic (1800×900), map by Björn Jónsson. North of ~50°N is reconstructed (no Voyager coverage) **per the author's description — this could NOT be confirmed from pixels**: that band's longitudinal detail measures 0.38 % against the mirrored southern band's 0.38 %, which the equirect projection explains on its own. Nor is it a fill copied from the south: r = 0.96 aligned but 0.96 shifted too, and only a gap between those is evidence of a copy. Depicts 1989 appearance — the Great Dark Spot has since dissipated | Free use with attribution | https://bjj.mmedia.is/data/neptune/index.html |
| `pluto-pia11707.jpg` | Pluto | New Horizons LORRI/MVIC global mosaic (PIA11707, 5926×2963), NASA/JHU-APL/SwRI. Un-imaged south polar band, **−90° to −54.1°** (19.9% of the map, measured; real data gap, kept — the band above it fades rather than cutting) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA11707 |
| `rings-color-bjj.txt` | Saturn rings | Radial colour profile, 13 177 samples spanning 74 510–140 390 km, from Voyager + Cassini data by Björn Jónsson | Free use with attribution | https://bjj.mmedia.is/data/s_rings/index.html |
| `rings-transparency-bjj.txt` | Saturn rings | Radial transparency profile, same sampling/span (1 = no ring material) | Free use with attribution | https://bjj.mmedia.is/data/s_rings/index.html |
| `moon-lroc-svs.tif` | Moon | NASA SVS CGI Moon Kit colour map (LRO LROC WAC, 2048×1024), NASA's Scientific Visualization Studio. Retrieved 2026-07-19 | Public domain | https://svs.gsfc.nasa.gov/4720 |
| `io-usgs-clrmerge.jpg` | Io | USGS "Io Galileo SSI / Voyager Color Merged Global Mosaic 1km", frozen at 4096×2048 RGB, a browse reduction made at retrieval 2026-07-19 (full 11445×5723 GeoTIFF is 189 MB), NASA/JPL/USGS. PDS label: PositiveWest, centre 0° — build flips to positive-east | Public domain | https://astrogeology.usgs.gov/search/map/io_galileo_ssi_voyager_color_merged_global_mosaic_1km |
| `europa-usgs-global.jpg` | Europa | USGS "Europa Voyager - Galileo SSI Global Mosaic 500m", frozen at 4096×2048 grayscale (measured chroma 0.00), a browse reduction made at retrieval 2026-07-19, NASA/JPL/USGS. PositiveWest, centre 180° — build flips. **Un-imaged south polar band, −90° to −84.1°** (3.3% of the map, measured, previously undisclosed here). Near-neutral body: build applies half the representative chroma over the mosaic's luminance | Public domain | https://astrogeology.usgs.gov/search/map/europa_voyager_galileo_ssi_global_mosaic_500m |
| `ganymede-usgs-clr.jpg` | Ganymede | USGS "Ganymede Voyager - Galileo SSI Global Color Mosaic 1435m" (Kersten et al. 2021), frozen at 4096×2048 RGB, a browse reduction made at retrieval 2026-07-19, NASA/JPL/USGS/DLR. PositiveEast, centre 180°. Genuine colour, not tinted (measured chroma 13.6). Its 5 black rows at the north pole are 0.24% of the map — the equirect singularity, under the 1% band floor, not a data gap | Public domain | https://astrogeology.usgs.gov/search/map/Ganymede/Voyager-Galileo/Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m |
| `callisto-usgs-global.jpg` | Callisto | USGS "Callisto Voyager - Galileo SSI Global Mosaic 1km", frozen at 4096×2048 grayscale (measured chroma 0.00), a browse reduction made at retrieval 2026-07-19, NASA/JPL/USGS. PositiveWest, centre 180° — build flips. Near-neutral body: build applies half the representative chroma over the mosaic's luminance | Public domain | https://astrogeology.usgs.gov/search/map/callisto_voyager_galileo_ssi_global_mosaic_1km |
| `mimas-pia18437.jpg` | Mimas | Cassini ISS global colour mosaic (PIA18437, 6356×3178, Schenk/LPI 2014 series, IR-G-UV enhanced colour), NASA/JPL-Caltech/SSI/LPI. Retrieved 2026-07-19. Enhanced colour, pulled halfway to gray at build (by eye, not a measurement) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18437 |
| `enceladus-pia18435.jpg` | Enceladus | Cassini ISS global colour mosaic (PIA18435, 15960×7980, same series). Enhanced colour, pulled halfway to gray at build (by eye, not a measurement) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18435 |
| `tethys-pia18439.jpg` | Tethys | Cassini ISS global colour mosaic (PIA18439, 13467×6734, same series). Enhanced colour, pulled halfway to gray at build (by eye, not a measurement) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18439 |
| `dione-pia18434.jpg` | Dione | Cassini ISS global colour mosaic (PIA18434, 14134×7067, same series). Enhanced colour, pulled halfway to gray at build (by eye, not a measurement) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18434 |
| `rhea-pia18438.jpg` | Rhea | Cassini ISS global colour mosaic (PIA18438, 12015×6008, same series). Enhanced colour, pulled halfway to gray at build (by eye, not a measurement) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18438 |
| `titan-iss-p19658.tif` | Titan | USGS "Titan ISS PIA19658 Global Mosaic 4km" (938 nm surface mosaic behind the haze, 4040×2020 grayscale, measured chroma 0.00), NASA/JPL/USGS. Build applies the FULL representative orange chroma — the visible body is haze, and none of this map's colour is imaged. PositiveWest, centre 180° — build flips. Retrieved 2026-07-19 | Public domain | https://astrogeology.usgs.gov/search/map/Titan/Cassini/Global-Mosaic/Titan_ISS_P19658_Mosaic_Global_4km |
| `iapetus-pia18436.jpg` | Iapetus | Cassini ISS global colour mosaic (PIA18436, 11741×5871, same 2014 series). Enhanced colour, pulled halfway to gray at build (by eye, not a measurement) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18436 |
| `triton-pia18668.jpg` | Triton | Voyager 2 global colour mosaic (PIA18668, 14138×7069, Schenk/LPI 2014). Un-imaged north polar band, **+90° to +43.2°** (26.0% of the map, measured; real data gap). Enhanced colour, pulled halfway to gray at build (by eye, not a measurement) | Public domain | https://photojournal.jpl.nasa.gov/catalog/PIA18668 |
| `rings-uranus.tsv` | Uranus rings | Authored table (not a download), values compiled 2026-07-18: the 10 narrow main rings' mid radii, mean widths and mid-range normal optical depths from the Earth-based + Voyager 2 occultation canon (French, Nicholson, Porco & Elliot 1991, in *Uranus*, Univ. of Arizona Press) | n/a (measured values) | https://ui.adsabs.harvard.edu/abs/1986Icar...67..134F/abstract |
| `rings-neptune.tsv` | Neptune rings | Authored table (not a download), values compiled 2026-07-18: Galle/Le Verrier/Lassell/Arago/Adams radii, widths and normal optical depths from Voyager 2 + stellar occultations (Porco et al. 1995, in *Neptune and Triton*, Univ. of Arizona Press); Adams τ is the azimuthal average folding in its arcs | n/a (measured values) | https://ui.adsabs.harvard.edu/abs/1995Icar..113..295N/abstract |
| `moon-dem-svs.tif` | Moon (relief) | NASA SVS CGI Moon Kit `ldem_64_uint.tif` (LRO LOLA), frozen at 4096×2048 — an area-average reduction made at retrieval 2026-08-16 from the 23040×11520 uint16, 506 MB original. **Carries NO GDAL scale tag and is NOT metres** — samples are half-metres above a 1727400 m datum; the published LOLA span −9110…+10760 m is the check. Centre 0°E, positive-east | Public domain | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_64_uint.tif |
| `mercury-dem-messenger.tif` | Mercury (relief) | USGS MESSENGER Global DEM 665 m v2 frozen at 4096×2048 — an area-average reduction made at retrieval 2026-08-16 from the 23040×11520 int16, 506 MB original (GDAL `SCALE` 0.5, nodata −32768, sphere radius 2439400 m). **Centre 180°E** — unlike its colour map, so the build rolls it | Public domain | https://planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif |
| `mars-dem-mola.tif` | Mars (relief) | USGS MGS MOLA DEM 463 m global mosaic frozen at 4096×2048 — an area-average reduction made at retrieval 2026-08-16 from the 46080×23040 int16-metres, 2.0 GB original (no scale tag, nodata −32768). Centre 0°E, positive-east | Public domain | https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif |

Venus is deliberately the **cloud deck**, not the Magellan radar
surface — the physically honest naked-eye appearance (2f6.6 design
record). Uranus has no source file: it ships texture-less by design.
The five Uranian moons also have no source: Voyager imaged their
southern hemispheres only, and a half-empty map reads worse than the
clean representative-colour spheroid.

The four USGS `*-usgs-*.jpg` files — Io, Europa, Ganymede, Callisto —
are 4096-px LANCZOS/JPEG-92
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

## Auditing

`scripts/textures/audit_sources.py` (manual) measures every frozen
source and prints what the rows above claim: dimensions, near-black
polar bands, the mirror test, and mean chroma. **Run it after any
source swap** — this table is what the next upgrade reasons from, so a
wrong row propagates into its replacement, and a row that makes
reconstructed pixels read as imaged is the one thing this project
cannot ship. `source-provenance.test.ts` holds the mechanical half in
CI.

What each check settles, and what it does not:

- **Dimensions** are mechanical and now pinned. This is where the rot
  was: 14 of 24 rows described a file without stating its size, the
  DEM rows quoting the original they were reduced from instead.
- **Polar gaps** are read as contiguous near-black bands, measured at the
  file's **native row count** — the working reduction the mirror and
  chroma passes run on quantises the band edge to 0.7° and would stop
  matching the tenths quoted above. Edge and map fraction come from the
  one run, so a row cannot pair them from different measurements. A band
  under 1 % of rows is the equirect pole singularity, not a gap —
  Ganymede's 5 rows of 2048 are 0.24 % and it is fully imaged.
- **Chroma** settles every "grayscale mosaic" claim outright: Mercury,
  Europa, Callisto and Titan all measure 0.00, and Ganymede's 13.6
  confirms its colour is imaged rather than applied.
- **Chroma *invention* is not measured at all** — the rows saying half,
  full or halfway-to-gray are reading `TINT_STRENGTH` and `DESATURATE`
  in `build-textures.py`, and the halfway-to-gray choice is by eye.
  `source-provenance.test.ts` pins each row's wording against the
  constant so the prose cannot drift off the build, which is all a test
  can do here: the judgement itself has no ground truth.
- **The mirror test cannot identify a mirror on its own.** North
  against a flipped south correlates highly for two innocent reasons —
  latitudinal banding (Venus 0.971, Saturn 0.802) and a longitudinal
  albedo province spanning both hemispheres (Iapetus 0.901). Shifting
  the comparison in longitude breaks the second but not the first, so
  the flag needs a near-unity alignment AND a collapse under shift.
  Nothing here trips it. Treat a flag as a prompt to look.
- **Reconstruction claims are not decidable from pixels**, which the
  Neptune row now says outright rather than implying it was verified.
  A flat-region test has no power on a gas giant, where the whole map
  is low-contrast, and high-latitude smoothness is what the equirect
  projection produces regardless. The script measures the band anyway,
  through the same shifted-baseline discipline as the mirror test: the
  claimed band correlates with the mirrored south at r = 0.96, and at
  0.96 under longitude shift too, so banding explains it and no copy is
  indicated. Reported without the shifted figure, that 0.96 would read
  as evidence of exactly the fill it rules out.

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
