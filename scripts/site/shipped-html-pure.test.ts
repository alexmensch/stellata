import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CAPTURE_CALL, withoutCaptureComments } from './shipped-html-pure';

const HOME = readFileSync(resolve(__dirname, '../../src/site/index.html'), 'utf8');

describe('withoutCaptureComments', () => {
  it('drops a capture recipe, line and all', () => {
    const html = '<a>\n    <!--\n    await debug.capture({ start: "A" });\n    -->\n  </a>';
    expect(withoutCaptureComments(html)).toBe('<a>\n  </a>');
  });

  it('keeps every other comment', () => {
    const html = '<p>Around <!-- count:build-catalog/recordCount sig2 -->980,000<!-- /count --> records.</p>';
    expect(withoutCaptureComments(html)).toBe(html);
  });

  it('ships the homepage without its recipes, which its source keeps', () => {
    expect(HOME).toContain(CAPTURE_CALL);
    expect(withoutCaptureComments(HOME)).not.toContain(CAPTURE_CALL);
    expect(withoutCaptureComments(HOME)).toContain('<video');
  });
});
