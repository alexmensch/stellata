/** A GET over a raw socket, redirects unfollowed. `fetch` drops `Sec-Fetch-*`, which routing depends on. */

import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface RawAnswer {
  status: number;
  location: string | null;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** A redirect's target as path and query, whichever origin it names. */
export function locationPath(location: string | null): string | null {
  if (location === null) return null;
  const url = new URL(location, 'https://any');
  return url.pathname + url.search;
}

/** What a browser sends on a top-level navigation. */
export const NAVIGATE = { 'sec-fetch-mode': 'navigate', accept: 'text/html' } as const;

export function rawGet(url: URL, headers: Readonly<Record<string, string>> = NAVIGATE): Promise<RawAnswer> {
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((done, fail) => {
    const req = request(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        done({
          status: res.statusCode!,
          location: res.headers.location ?? null,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end();
  });
}
