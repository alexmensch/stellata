// Hand-written body → frozen Stellata ID pins for the Sol system, minted
// from data/sid/sol-objects.tsv. See src/client/solar-system/README.md
// § Sol-system SID pins.

export const SOL_OBJECT_SIDS: Readonly<Record<string, number>> = {
  sun: 306055,
  mercury: 327672,
  venus: 327673,
  earth: 327674,
  mars: 327675,
  jupiter: 327676,
  saturn: 327677,
  uranus: 327678,
  neptune: 327679,
  pluto: 327680,
};
