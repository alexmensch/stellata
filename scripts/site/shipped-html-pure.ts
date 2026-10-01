/** What the site build takes out of a page before it ships. README.md#what-ships. */

const COMMENT = /^[ \t]*<!--((?:(?!-->)[\s\S])*)-->[ \t]*\n?/gm;

export const CAPTURE_CALL = 'debug.capture(';

export function withoutCaptureComments(html: string): string {
  return html.replace(COMMENT, (comment, body: string) => (body.includes(CAPTURE_CALL) ? '' : comment));
}
