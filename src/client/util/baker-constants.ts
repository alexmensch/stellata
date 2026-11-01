// see data/schema/README.md
import constants from '../../../data/schema/constants.json';

export interface GalacticFrame {
  readonly centreRaDeg: number;
  readonly centreDecDeg: number;
  readonly northPoleRaDeg: number;
  readonly northPoleDecDeg: number;
}

export const GALACTIC_FRAME: GalacticFrame = constants.galacticFrame;

/** V-band extinction per unit Edenhofer/ZGR dust density: A_V = this · ∫E dl. */
export const AV_PER_EZGR: number = constants.extinction.avPerEzgr;

/** A_V rate [mag/pc] per hydrogen number density n_H [cm⁻³]. */
export const AV_PER_NH_PC: number = constants.extinction.avPerNhPc;
