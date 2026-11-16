import { describe, expect, it } from 'vitest';

import { fitsBytes } from './fits-fixture';
import { QUIET_DEPS } from './recorded-reply';
import {
  GAIA, GAIA_ESA, SIMBAD, TapOverflow, TapRefused, TapTransient, VIZIER, csvText, readAsuTsv, hardRowLimit, queryStatus, readCsv, tapClient, textReply,
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
    ...QUIET_DEPS, transport, report: (s) => reported.push(s),
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
  it.each([['Gaia', GAIA], ['SIMBAD', SIMBAD]] as const)(
    '%s: a truncated answer raises, and no other mirror is asked',
    async (_, archive) => {
      const { client, syncCalls } = fake(({ url }) => (url.endsWith('/capabilities') ? capabilities(null) : csv(rowsCsv(6))));
      await expect(client(archive).query({ adql: 'SELECT id FROM t' }, 5)).rejects.toThrow(TapOverflow);
      expect(syncCalls()).toHaveLength(1);
      expect(syncCalls()[0].form?.get('MAXREC')).toBe('6');
      expect(syncCalls()[0].form?.get('FORMAT')).toBe('csv');
    },
  );

  it('VizieR: asks CDS for FITS, and a truncated answer raises without asking CfA', async () => {
    const asu = { source: 't', columns: [{ archive: 'ID', name: 'id' }], constraints: {} };
    const { client, calls, syncCalls } = fake(({ url }) => (url.endsWith('/capabilities') ? capabilities(null)
      : fits(fitsBytes([{ name: 'id', form: 'J' }], Array.from({ length: 6 }, (_, i) => [i])))));
    await expect(client(VIZIER).query({ adql: 'SELECT id FROM t', asu }, 5)).rejects.toThrow(TapOverflow);
    expect(syncCalls()[0].form?.get('FORMAT')).toBe('fits');
    expect(calls.some((c) => c.url.includes('cfa'))).toBe(false);
  });

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
    await expect(client(GAIA_ESA).query({ adql: 'Q' }, 10)).rejects.toThrow('ESA-sync: HTTP 503, Message: Server overloaded');
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
        { name: 'ASU', protocol: 'asu', verified: true, url: 'https://asu.example/viz-bin' },
      ],
      format: 'fits',
      retryDelaysMs: [0],
      quote: (id) => `"${id}"`,
    };
    const ASU: AsuQuery = {
      source: 'IV/27A/catalog',
      columns: [{ archive: 'HD', name: 'hd' }, { archive: 'Fl', name: 'flamsteed' }, { archive: 'RA(ICRS)', name: 'ra' }],
      constraints: { HD: '1..800' },
    };
    const QUERY = { adql: 'SELECT "HD" AS hd, "Fl" AS flamsteed, "RA(ICRS)" AS ra FROM "IV/27A/catalog"', asu: ASU };
    type Row = readonly [number, number | null, number];
    const binfits = (rows: readonly Row[]) => fits(fitsBytes(
      [{ name: 'HD', form: 'J', tnull: -2147483648 }, { name: 'Fl', form: 'I', tnull: -32768 }, { name: 'RA_ICRS_', form: 'D', tdisp: 'F12.8' }, { name: 'recno', form: 'J' }],
      rows.map(([hd, fl, ra], i) => [hd, fl ?? 0, ra, i + 1]),
    ));
    const tsvText = (rows: readonly Row[], header = 'HD\tFl\tRA(ICRS)') => [
      '#', '#INFO\tservice_protocol=ASU', '#Column\te_plx\t(F5.2)\tError in parallax', '', header, ' \t \tdeg', '------\t---\t------------',
      ...rows.map(([hd, fl, ra]) => `${String(hd).padStart(6)}\t${fl === null ? '   ' : String(fl).padStart(3)}\t${ra.toFixed(8).padStart(12)}`), '',
    ].join('\n');
    const tsv = (rows: readonly Row[], header?: string) => textReply(200, 'text/tab-separated-values', tsvText(rows, header));
    const asu = (rows: readonly Row[], replies: { tsv?: () => HttpReply; fits?: () => HttpReply } = {}) => ({ url }: Call) => {
      const { host, pathname } = new URL(url);
      if (host === 'tap.example') return new Error('connect ETIMEDOUT');
      return pathname.endsWith('/asu-tsv') ? (replies.tsv ?? (() => tsv(rows)))() : (replies.fits ?? (() => binfits(rows)))();
    };
    const ROWS: readonly Row[] = [[493, null, 1.5], [3, 33, 104.550895415]];

    it('asks TAP for FITS and writes each float at its declared precision', async () => {
      const { client, syncCalls } = fake(({ url }) => (url.endsWith('/capabilities') ? capabilities(null)
        : fits(fitsBytes([{ name: 'hd', form: 'J' }, { name: 'ra', form: 'D', tdisp: 'F12.8' }], [[3, 104.550895415]]))));
      const answer = await client(ARCHIVE).query(QUERY, 5);
      expect(syncCalls()[0].form?.get('FORMAT')).toBe('fits');
      expect(answer.result).toEqual({ columns: ['hd', 'ra'], rows: [['3', '104.55089542']] });
      expect(readCsv(answer.body, 5, 't')).toEqual(answer.result);
    });

    it('falls back to ASU: floats from its FITS, every other cell from its TSV, whose blank is the null its FITS writes as 0', async () => {
      const { client, calls, reported } = fake(asu(ROWS));
      const answer = await client(ARCHIVE).query(QUERY, 5);
      const asked = calls.map((c) => new URL(c.url)).filter((u) => u.host === 'asu.example');
      expect(asked.map((u) => u.pathname)).toEqual(['/viz-bin/asu-tsv', '/viz-bin/asu-binfits']);
      expect([...asked[1].searchParams]).toEqual([['-source', 'IV/27A/catalog'], ['-out', 'HD,Fl,RA(ICRS)'], ['HD', '1..800'], ['-out.max', '6']]);
      expect(answer.result).toEqual({ columns: ['hd', 'flamsteed', 'ra'], rows: [['493', null, '1.50000000'], ['3', '33', '104.55089542']] });
      expect(reported).toEqual(['ASU']);
    });

    it('refuses an ASU reply one row past the limit', async () => {
      const { client } = fake(asu([...ROWS, [4, 1, 0]]));
      await expect(client(ARCHIVE).query(QUERY, 2)).rejects.toThrow(TapOverflow);
    });

    it('refuses ASU replies that dropped an asked column, as ASU does an unknown one', async () => {
      const { client } = fake(asu(ROWS, { tsv: () => tsv(ROWS, 'HD\tSn\tRA(ICRS)') }));
      await expect(client(ARCHIVE).query(QUERY, 5)).rejects.toThrow(/ASU answered columns \[HD, Sn, RA\(ICRS\)\] for the asked \[HD, Fl, RA\(ICRS\)\]/);
    });

    it('refuses the two replies where a cell both report disagrees: they are not of the same rows', async () => {
      const { client } = fake(asu(ROWS, { fits: () => binfits([ROWS[0], [3, 34, 104.550895415]]) }));
      await expect(client(ARCHIVE).query(QUERY, 5)).rejects.toThrow(/row 2 flamsteed is "33" in ASU's TSV and "34" in its FITS/);
    });

    it('refuses a float one reply prints and the other leaves null', async () => {
      const nanInFits = fake(asu(ROWS, { fits: () => binfits([ROWS[0], [3, 33, Number.NaN]]) }));
      await expect(nanInFits.client(ARCHIVE).query(QUERY, 5)).rejects.toThrow(/row 2 ra is "104.5508954\d" in ASU's TSV and "" in its FITS/);
      const blankInTsv = textReply(200, 'text/tab-separated-values', tsvText(ROWS).replace('  1.50000000', ' '.repeat(12)));
      const zeroInFits = fake(asu(ROWS, { tsv: () => blankInTsv, fits: () => binfits([[493, null, 0], ROWS[1]]) }));
      await expect(zeroInFits.client(ARCHIVE).query(QUERY, 5)).rejects.toThrow(/row 1 ra is "" in ASU's TSV and "0.00000000" in its FITS/);
    });

    it('retries when the two replies hold different row counts, or the FITS is cut short', async () => {
      let replies = 0;
      const { client } = fake(asu(ROWS, {
        fits: () => {
          replies++;
          if (replies === 1) return binfits([ROWS[0]]);
          const whole = binfits(ROWS);
          return replies === 2 ? { ...whole, body: whole.body.subarray(0, 1120) } : whole;
        },
      }));
      expect((await client({ ...ARCHIVE, retryDelaysMs: [0, 0] }).query(QUERY, 5)).result.rows).toHaveLength(2);
      expect(replies).toBe(3);
    });

    it('reads no rows from a TSV with none and a FITS file with no table', async () => {
      const { client } = fake(asu([], { fits: () => fits(fitsBytes(null)) }));
      expect((await client(ARCHIVE).query(QUERY, 5)).result).toEqual({ columns: ['hd', 'flamsteed', 'ra'], rows: [] });
    });

    it('reads an unreachable database in the TSV as transient, and any other error line as a query fault', () => {
      expect(() => readAsuTsv('#INFO\tError=The database is not currently reachable.\n', 5, 'CfA')).toThrow(TapTransient);
      expect(() => readAsuTsv('#INFO\tError=Postgres connect error\n', 5, 'CfA')).toThrow(TapTransient);
      expect(() => readAsuTsv('#INFO\tError=Unknown constraint column\n', 5, 'CfA')).toThrow(TapRefused);
      expect(readAsuTsv('#Column\te_plx\t(F5.2)\tError in parallax\n', 5, 'CfA')).toEqual({ columns: [], rows: [] });
    });

    it('reads a data cell naming an outage as data', () => {
      const reply = 'name\n----\n----\nno connection\n';
      expect(readAsuTsv(reply, 5, 'CfA')).toEqual({ columns: ['name'], rows: [['no connection']] });
    });

    it('refuses to send an ASU mirror a query with no ASU form', async () => {
      const { client } = fake(asu(ROWS));
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
