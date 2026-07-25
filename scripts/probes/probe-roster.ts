// The five Sun-escape probes: HORIZONS target ids + hand-curated mission
// facts that the fetched trajectory carries into data/probes/{id}.json.

export type ProbeMission = {
  id: string;
  label: string;
  /** HORIZONS COMMAND target id (negative = spacecraft). */
  horizonsId: string;
  /** Earliest epoch the JPL SPK covers; HORIZONS errors before it. */
  ephemerisStart: string;
  /** Canonical mission launch instant, ISO-8601 UTC. */
  launchUtc: string;
  /** Last contact, ISO-8601 UTC; null while the probe still transmits. */
  lastContactUtc: string | null;
  /** One-line mission summary for the focus card. */
  mission: string;
};

export const PROBE_MISSIONS: ProbeMission[] = [
  {
    id: 'pioneer10',
    label: 'Pioneer 10',
    horizonsId: '-23',
    ephemerisStart: '1972-03-04',
    launchUtc: '1972-03-03T01:49:00Z',
    lastContactUtc: '2003-01-23T00:00:00Z',
    mission: 'First probe to Jupiter (1973) and first on a Sun-escape trajectory.',
  },
  {
    id: 'pioneer11',
    label: 'Pioneer 11',
    horizonsId: '-24',
    ephemerisStart: '1973-04-07',
    launchUtc: '1973-04-06T02:11:00Z',
    lastContactUtc: '1995-09-30T00:00:00Z',
    mission: 'First probe to Saturn (1979), via a Jupiter gravity assist.',
  },
  {
    id: 'voyager1',
    label: 'Voyager 1',
    horizonsId: '-31',
    ephemerisStart: '1977-09-06',
    launchUtc: '1977-09-05T12:56:00Z',
    lastContactUtc: null,
    mission: 'Jupiter and Saturn flybys; crossed the heliopause in 2012.',
  },
  {
    id: 'voyager2',
    label: 'Voyager 2',
    horizonsId: '-32',
    ephemerisStart: '1977-08-21',
    launchUtc: '1977-08-20T14:29:00Z',
    lastContactUtc: null,
    mission: 'Only probe to visit Uranus and Neptune; heliopause in 2018.',
  },
  {
    id: 'newhorizons',
    label: 'New Horizons',
    horizonsId: '-98',
    ephemerisStart: '2006-01-20',
    launchUtc: '2006-01-19T19:00:00Z',
    lastContactUtc: null,
    mission: 'Pluto flyby 2015, Arrokoth 2019; now surveying the Kuiper Belt.',
  },
];
