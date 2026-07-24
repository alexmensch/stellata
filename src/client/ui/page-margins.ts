// Reads the `--page-margin-*` custom properties every fixed chrome
// container is positioned by, for the overlays that place themselves in
// JS. See ./README.md § Page margins.

export type PageMargins = { x: number; top: number; bottom: number };

// Zero, deliberately, not a copy of the stylesheet's numbers: styles.css
// is the single source and a second copy here would drift. A document
// without the stylesheet degrades to flush-to-edge placement rather than
// to NaN offsets.
function px(style: CSSStyleDeclaration, name: string): number {
  const v = parseFloat(style.getPropertyValue(name));
  return Number.isFinite(v) ? v : 0;
}

// Resolved against `:root`, so a consumer caching the result at
// construction is safe — nothing rewrites these at runtime.
export function readPageMargins(): PageMargins {
  const style = getComputedStyle(document.documentElement);
  return {
    x: px(style, '--page-margin-x'),
    top: px(style, '--page-margin-top'),
    bottom: px(style, '--page-margin-bottom'),
  };
}
