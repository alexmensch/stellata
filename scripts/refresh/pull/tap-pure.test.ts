import { describe, expect, it } from 'vitest';

import { fitsBytes } from './fits-fixture';
import {
  GAIA, SIMBAD, TapOverflow, TapRefused, VIZIER, csvText, hardRowLimit, queryStatus, readCsv, tapClient, textReply,
  type AsuQuery, type HttpReply, type TapArchive, type Transport,
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

const csv = (body: string): HttpReply => textReply(200, 'text/csv;charset=UTF-8', body);
const capabilities = (hard: number | null): HttpReply =>
  textReply(200, 'text/xml', hard === null ? '<capabilities/>' : `<outputLimit><hard unit="row">${hard}</hard></outputLimit>`);
const fits = (bytes: Uint8Array): HttpReply => ({ status: 200, contentType: 'application/fits', body: bytes });
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
      await expect(client(archive).query({ adql: 'SELECT id FROM t' }, 5)).rejects.toThrow(TapOverflow);
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
    await client(GAIA).query({ adql: 'Q' }, 60_000);
    expect(syncCalls().map((c) => c.url)).toEqual(['https://gaia.ari.uni-heidelberg.de/tap/sync']);
    expect(reported).toEqual(['ARI-sync']);
  });

  it('falls back past a mirror whose /capabilities fails, whatever its status', async () => {
    const { client, syncCalls, reported } = fake(({ url }) => {
      if (url.includes('esac') && url.endsWith('/capabilities')) return textReply(404, 'text/html', '<html>not found</html>');
      return url.endsWith('/capabilities') ? capabilities(null) : csv(rowsCsv(1));
    });
    await client(GAIA).query({ adql: 'Q' }, 10);
    expect(syncCalls().map((c) => c.url)).toEqual(['https://gaia.ari.uni-heidelberg.de/tap/sync']);
    expect(reported).toEqual(['ARI-sync']);
  });

  it('refuses when no mirror can hold limit + 1', async () => {
    const { client, syncCalls } = fake(() => capabilities(1_000));
    await expect(client(GAIA).query({ adql: 'Q' }, 1_000)).rejects.toThrow(/no mirror returns 1001 rows/);
    expect(syncCalls()).toHaveLength(0);
  });

  it('retries an overloaded mirror, falls back, and asks the answering mirror first from then on', async () => {
    const { client, syncCalls, reported } = fake(({ url }) => {
      if (url.endsWith('/capabilities')) return capabilities(null);
      return url.includes('esac') ? textReply(503, 'text/html', '<html>Server overloaded</html>') : csv(rowsCsv(1));
    });
    const gaia = client(GAIA);
    await gaia.query({ adql: 'Q1' }, 10);
    expect(syncCalls().filter((c) => c.url.includes('esac'))).toHaveLength(GAIA.retryDelaysMs.length + 1);
    await gaia.query({ adql: 'Q2' }, 10);
    expect(syncCalls().at(-1)?.url).toContain('heidelberg');
    expect(syncCalls().filter((c) => c.url.includes('esac'))).toHaveLength(GAIA.retryDelaysMs.length + 1);
    expect(reported).toEqual(['ARI-sync', 'ARI-sync']);
  });

  it('reports an HTML error page by its text, not its markup', async () => {
    const page = '<html><head><style>body { color: black; }</style></head><body><li><b>Message: </b>Server overloaded</li></body></html>';
    const { client } = fake(({ url }) => (
      url.endsWith('/capabilities') ? capabilities(null) : textReply(503, 'text/html', page)
    ));
    await expect(client(VIZIER).query({ adql: 'Q' }, 10)).rejects.toThrow('CDS: HTTP 503, Message: Server overloaded');
  });

  it('a network failure is transient too', async () => {
    const { client, reported } = fake(({ url }) => {
      if (url.endsWith('/capabilities')) return capabilities(null);
      return url.includes('unistra') ? new Error('connect ETIMEDOUT') : csv(rowsCsv(1));
    });
    await client(SIMBAD).query({ adql: 'Q' }, 10);
    expect(reported).toEqual(['SIMBAD-Harvard']);
  });

  it('a query fault fails at once, with the archive\'s own message, on either status', async () => {
    for (const status of [400, 500]) {
      const { client, syncCalls } = fake(({ url }) => (
        url.endsWith('/capabilities') ? capabilities(null) : textReply(status, 'application/xml', ARI_UNKNOWN_COLUMN)
      ));
      await expect(client(GAIA).query({ adql: 'SELECT nosuchcol FROM gaiadr3.gaia_source' }, 10)).rejects.toThrow(TapRefused);
      expect(syncCalls()).toHaveLength(1);
    }
  });

  describe('FITS and ASU', () => {
    const ARCHIVE: TapArchive = {
      mirrors: [
        { name: 'TAP', protocol: 'tap', verified: true, url: 'https://tap.example/tap' },
        { name: 'ASU', protocol: 'asu', verified: true, url: 'https://asu.example/viz-bin/asu-binfits' },
      ],
      format: 'fits',
      retryDelaysMs: [0],
      quote: (id) => `"${id}"`,
    };
    const ASU: AsuQuery = {
      source: 'I/311/hip2',
      columns: [{ archive: 'HIP', name: 'hip' }, { archive: 'RArad', name: 'ra_icrs' }],
      constraints: { HIP: '1..2' },
    };
    const QUERY = { adql: 'SELECT "HIP" AS hip, "RArad" AS ra_icrs FROM "I/311/hip2" WHERE "HIP" BETWEEN 1 AND 2', asu: ASU };
    const asuReply = (rows: readonly (readonly [number, number])[]) => fits(fitsBytes(
      [{ name: 'HIP', form: 'J' }, { name: 'RArad', form: 'D' }, { name: 'recno', form: 'J' }],
      rows.map(([hip, ra], i) => [hip, ra, i + 1]),
    ));
    const tapDown = (asu: () => HttpReply) => ({ url }: Call) => (url.startsWith('https://tap.example') ? new Error('connect ETIMEDOUT') : asu());

    it('asks TAP for FITS and keeps each stored double whole', async () => {
      const { client, syncCalls } = fake(({ url }) => (url.endsWith('/capabilities') ? capabilities(null)
        : fits(fitsBytes([{ name: 'hip', form: 'J' }, { name: 'ra_icrs', form: 'D' }], [[1, 0.0022211629]]))));
      const answer = await client(ARCHIVE).query(QUERY, 5);
      expect(syncCalls()[0].form?.get('FORMAT')).toBe('fits');
      expect(answer.result).toEqual({ columns: ['hip', 'ra_icrs'], rows: [['1', '0.0022211629']] });
      expect(readCsv(answer.body, 5, 't')).toEqual(answer.result);
    });

    it('falls back to ASU: archive columns asked, answered under their names, ASU\'s own link columns dropped', async () => {
      const { client, calls, reported } = fake(tapDown(() => asuReply([[1, 0.0022211629], [2, 0.0054342798]])));
      const answer = await client(ARCHIVE).query(QUERY, 5);
      const asked = new URL(calls.at(-1)!.url);
      expect([...asked.searchParams]).toEqual([['-source', 'I/311/hip2'], ['-out', 'HIP,RArad'], ['HIP', '1..2'], ['-out.max', '6']]);
      expect(answer.result).toEqual({ columns: ['hip', 'ra_icrs'], rows: [['1', '0.0022211629'], ['2', '0.0054342798']] });
      expect(reported).toEqual(['ASU']);
    });

    it('refuses an ASU reply one row past the limit', async () => {
      const { client } = fake(tapDown(() => asuReply([[1, 0], [2, 0], [3, 0]])));
      await expect(client(ARCHIVE).query(QUERY, 2)).rejects.toThrow(TapOverflow);
    });

    it('refuses an ASU reply that dropped an asked column, as ASU does an unknown one', async () => {
      const { client } = fake(tapDown(() => fits(fitsBytes([{ name: 'HIP', form: 'J' }, { name: 'Sn', form: 'I' }], [[1, 5]]))));
      await expect(client(ARCHIVE).query(QUERY, 5)).rejects.toThrow(/ASU answered columns \[HIP, Sn\] for the asked \[HIP, RArad\]/);
    });

    it('reads an ASU file with no table as no rows', async () => {
      const { client } = fake(tapDown(() => fits(fitsBytes(null))));
      expect((await client(ARCHIVE).query(QUERY, 5)).result).toEqual({ columns: ['hip', 'ra_icrs'], rows: [] });
    });

    it('retries a FITS reply cut short', async () => {
      let replies = 0;
      const { client } = fake(tapDown(() => {
        const whole = asuReply([[1, 0.5]]);
        return replies++ === 0 ? { ...whole, body: whole.body.subarray(0, 1120) } : whole;
      }));
      expect((await client(ARCHIVE).query(QUERY, 5)).result.rows).toEqual([['1', '0.5']]);
      expect(replies).toBe(2);
    });

    it('refuses to send an ASU mirror a query with no ASU form', async () => {
      const { client } = fake(tapDown(() => asuReply([])));
      await expect(client(ARCHIVE).query({ adql: QUERY.adql }, 5)).rejects.toThrow(/answers ASU only/);
    });
  });

  it('csvText writes what readCsv reads back, a null as the empty cell', () => {
    const rows = [['1', 'LEDA  157356, b', null], ['2', 'say "hi"', 'x']];
    expect(readCsv(csvText(['oid', 'main_id', 'rv'], rows), 2, 't')).toEqual({ columns: ['oid', 'main_id', 'rv'], rows });
  });

  it('states every mirror as its service list', () => {
    expect(fake(() => csv('')).client(SIMBAD).services).toEqual(['SIMBAD-CDS', 'SIMBAD-Harvard']);
  });
});
