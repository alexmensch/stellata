// Stage 4's build-log line, read off the Stage4Result it returned.

import { countsListed } from '../build-log-pure';
import { orbitTally, type Stage4Result } from './attach-orbits';

export function stage4Report(result: Stage4Result): string[] {
  return [`orbits sourced: ${countsListed(orbitTally(result))}`];
}
