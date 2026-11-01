// see data/schema/README.md
import constants from '../../../data/schema/constants.json';

export interface GalacticFrame {
  readonly centreRaDeg: number;
  readonly centreDecDeg: number;
  readonly northPoleRaDeg: number;
  readonly northPoleDecDeg: number;
}

export const GALACTIC_FRAME: GalacticFrame = constants.galacticFrame;
