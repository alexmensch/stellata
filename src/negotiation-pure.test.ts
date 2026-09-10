// Which rendition an `Accept` header asks for. The rule decides what every
// browser, crawler and agent fetcher is handed at `/`, so this suite holds
// the negative hardest: the headers that must keep getting HTML.

import { describe, expect, it } from 'vitest';

import { markdownRendition, prefersMarkdown, wantsDocument } from './negotiation-pure';

describe('a page’s markdown sibling', () => {
  it('sits beside the document it renders', () => {
    expect(markdownRendition('/')).toBe('/index.md');
  });

  it.each(['/app', '/app/v/AQAA/', '/index.md', '/science', '/catalog.bin.0'])(
    'is absent for %s',
    (pathname) => {
      expect(markdownRendition(pathname)).toBeNull();
    },
  );
});

describe('markdown is opt-in, by naming the type', () => {
  it.each([
    'text/markdown',
    'text/markdown, */*;q=0.8',
    'text/markdown;q=1.0, text/html;q=0.9',
    'text/plain, text/markdown',
  ])('answers markdown to %s', (accept) => {
    expect(prefersMarkdown(accept)).toBe(true);
  });

  // Every one of these is a client that must keep getting HTML. `*/*` is
  // curl's default and most agent fetchers'; the long form is a browser's.
  it.each([
    ['*/*', 'a wildcard, which names nothing'],
    ['text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'a browser'],
    ['text/*', 'a wildcard within the text group'],
    ['text/plain', 'a client that wants plain text'],
    ['text/html, text/markdown;q=0.5', 'a client that ranks HTML above markdown'],
    ['text/markdown;q=0', 'a client that refuses markdown outright'],
  ])('answers HTML to %s (%s)', (accept) => {
    expect(prefersMarkdown(accept)).toBe(false);
  });

  it('answers HTML when the client says nothing at all', () => {
    expect(prefersMarkdown(null)).toBe(false);
  });

  // Equal ranking goes to markdown: a client that named the type at all
  // asked for it, and HTML is what it gets by not naming it.
  it('answers markdown when the two rank equally', () => {
    expect(prefersMarkdown('text/html, text/markdown')).toBe(true);
  });
});

describe('whether a document is the right answer at all', () => {
  // The deploy serves the homepage whatever the client asked for, so a dev
  // server that required `text/html` 404'd the root for every agent fetcher
  // and every curl. This is the rule that stops the two diverging.
  it.each([
    '*/*',
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'text/html',
    'text/markdown',
    'text/*',
  ])('serves a document to %s', (accept) => {
    expect(wantsDocument(accept)).toBe(true);
  });

  it('serves a document when the client says nothing at all', () => {
    expect(wantsDocument(null)).toBe(true);
  });

  // An explicit non-document Accept is an asset fetch, and a miss there is a
  // missing asset rather than a page to render.
  it.each(['image/png', 'application/json', 'image/avif,image/webp'])(
    'leaves %s to fall through as an asset miss',
    (accept) => {
      expect(wantsDocument(accept)).toBe(false);
    },
  );
});
