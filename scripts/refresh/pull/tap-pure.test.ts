import { describe, expect, it } from 'vitest';

import {
  GAIA, SIMBAD, TapOverflow, TapRefused, VIZIER, hardRowLimit, queryStatus, readCsv, tapClient,
  type HttpReply, type TapArchive, type Transport,
} from './tap-pure';

const ARI_CAPABILITIES = `<capabilities><capability><outputLimit>
  <default unit="row">100000</default>
  <hard unit="row">10000000</hard>
</outputLimit></capability></capabilities>`;

const ARI_UNKNOWN_COLUMN = `<?xml version="1.0" encoding="utf-8"?>
<VOTABLE version="1.4"><RESOURCE type="results">
<INFO name="QUERY_STATUS" value="ERROR">Incorrect ADQL query: 1 unresolved identifiers: nosuchcol [l.1 c.15 - l.1 c.24]!
  - Unknown column "nosuchcol" !</INFO>
<INFO name="PROVIDER" value="ARI">ARI's TAP access to the Gaia Archive.</INFO>
</RESOURCE></VOTABLE>`;

const csv = (body: string): HttpReply => ({ status: 200, contentType: 'text/csv;charset=UTF-8', body });
const capabilities = (hard: number | null): HttpReply => ({
  status: 200,
  contentType: 'text/xml',
  body: hard === null ? '<capabilities/>' : `<outputLimit><hard unit="row">${hard}</hard></outputLimit>`,
});
const rowsCsv = (n: number): string => ['id', ...Array.from({ length: n }, (_, i) => String(i))].join('\n');

interface Call { readonly url: string; readonly form?: URLSearchParams }

function fake(answer: (call: Call) => HttpReply | Error) {
  const calls: Call[] = [];
  const transport: Transport = async (url, form) => {
    calls.push({ url, form });
    const reply = answer({ url, form });
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const reported: string[] = [];
  const client = (archive: TapArchive) => tapClient(archive, {
    transport, sleep: async () => {}, report: (s) => reported.push(s), log: () => {},
  });
  const syncCalls = () => calls.filter((c) => c.url.endsWith('/sync'));
  return { calls, syncCalls, reported, client };
}

describe('readCsv', () => {
  it('reads an empty cell as null and a quoted cell whole', () => {
    expect(readCsv('oid,main_id,rv\n5035770,"LEDA  157356, b",\n', 1, 't')).toEqual({
      columns: ['oid', 'main_id', 'rv'],
      rows: [['5035770', 'LEDA  157356, b', null]],
    });
  });

  it('passes exactly the limit and refuses one row more', () => {
    expect(readCsv(rowsCsv(3), 3, 't').rows).toHaveLength(3);
    expect(() => readCsv(rowsCsv(4), 3, 't')).toThrow(TapOverflow);
  });
});

describe('queryStatus and hardRowLimit', () => {
  it('lifts the archive message from a VOTable error body', () => {
    expect(queryStatus(ARI_UNKNOWN_COLUMN)).toEqual({
      value: 'ERROR',
      message: 'Incorrect ADQL query: 1 unresolved identifiers: nosuchcol [l.1 c.15 - l.1 c.24]! - Unknown column "nosuchcol" !',
    });
    expect(queryStatus('<INFO name="QUERY_STATUS" value="OVERFLOW"/>')).toEqual({ value: 'OVERFLOW', message: '' });
  });

  it('reads the hard row cap, and none when the mirror declares none', () => {
    expect(hardRowLimit(ARI_CAPABILITIES)).toBe(10_000_000);
    expect(hardRowLimit('<capabilities/>')).toBeNull();
  });
});

describe('tapClient', () => {
  it.each([['Gaia', GAIA], ['VizieR', VIZIER], ['SIMBAD', SIMBAD]] as const)(
    '%s: a truncated answer raises, and no other mirror is asked',
    async (_, archive) => {
      const { client, syncCalls } = fake(({ url }) => (url.endsWith('/capabilities') ? capabilities(null) : csv(rowsCsv(6))));
      await expect(client(archive).query('SELECT id FROM t', 5)).rejects.toThrow(TapOverflow);
      expect(syncCalls()).toHaveLength(1);
      expect(syncCalls()[0].form?.get('MAXREC')).toBe('6');
      expect(syncCalls()[0].form?.get('FORMAT')).toBe('csv');
    },
  );

  it('skips a mirror whose hard cap cannot hold limit + 1', async () => {
    const { client, syncCalls, reported } = fake(({ url }) => {
      if (url.endsWith('/capabilities')) return capabilities(url.includes('esac') ? 50_000 : 10_000_000);
      return csv(rowsCsv(2));
    });
    await client(GAIA).query('Q', 60_000);
    expect(syncCalls().map((c) => c.url)).toEqual(['https://gaia.ari.uni-heidelberg.de/tap/sync']);
    expect(reported).toEqual(['ARI-sync']);
  });

  it('refuses when no mirror can hold limit + 1', async () => {
    const { client, syncCalls } = fake(() => capabilities(1_000));
    await expect(client(GAIA).query('Q', 1_000)).rejects.toThrow(/no mirror returns 1001 rows/);
    expect(syncCalls()).toHaveLength(0);
  });

  it('retries an overloaded mirror, falls back, and asks the answering mirror first from then on', async () => {
    const { client, syncCalls, reported } = fake(({ url }) => {
      if (url.endsWith('/capabilities')) return capabilities(null);
      return url.includes('esac') ? { status: 503, contentType: 'text/html', body: '<html>Server overloaded</html>' } : csv(rowsCsv(1));
    });
    const gaia = client(GAIA);
    await gaia.query('Q1', 10);
    expect(syncCalls().filter((c) => c.url.includes('esac'))).toHaveLength(GAIA.retryDelaysMs.length + 1);
    await gaia.query('Q2', 10);
    expect(syncCalls().at(-1)?.url).toContain('heidelberg');
    expect(syncCalls().filter((c) => c.url.includes('esac'))).toHaveLength(GAIA.retryDelaysMs.length + 1);
    expect(reported).toEqual(['ARI-sync', 'ARI-sync']);
  });

  it('reports an HTML error page by its text, not its markup', async () => {
    const page = '<html><head><style>body { color: black; }</style></head><body><li><b>Message: </b>Server overloaded</li></body></html>';
    const { client } = fake(({ url }) => (
      url.endsWith('/capabilities') ? capabilities(null) : { status: 503, contentType: 'text/html', body: page }
    ));
    await expect(client(VIZIER).query('Q', 10)).rejects.toThrow('CDS: HTTP 503, Message: Server overloaded');
  });

  it('a network failure is transient too', async () => {
    const { client, reported } = fake(({ url }) => {
      if (url.endsWith('/capabilities')) return capabilities(null);
      return url.includes('unistra') ? new Error('connect ETIMEDOUT') : csv(rowsCsv(1));
    });
    await client(SIMBAD).query('Q', 10);
    expect(reported).toEqual(['SIMBAD-Harvard']);
  });

  it('a query fault fails at once, with the archive\'s own message, on either status', async () => {
    for (const status of [400, 500]) {
      const { client, syncCalls } = fake(({ url }) => (
        url.endsWith('/capabilities') ? capabilities(null) : { status, contentType: 'application/xml', body: ARI_UNKNOWN_COLUMN }
      ));
      await expect(client(GAIA).query('SELECT nosuchcol FROM gaiadr3.gaia_source', 10)).rejects.toThrow(TapRefused);
      expect(syncCalls()).toHaveLength(1);
    }
  });

  it('states every mirror as its service list', () => {
    expect(fake(() => csv('')).client(SIMBAD).services).toEqual(['SIMBAD-CDS', 'SIMBAD-Harvard']);
  });
});
