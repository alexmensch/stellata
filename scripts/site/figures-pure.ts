/** The figures a page asks for as `%VITE_…%` tokens, and the one substitution every rendition goes through. README.md#the-figures. */

export const FIGURE_NAMES = ['VITE_APP_VERSION', 'VITE_STAR_COUNT', 'VITE_SOURCE_COUNT', 'VITE_REFERENCE_COUNT'] as const;

export type FigureName = (typeof FIGURE_NAMES)[number];

export type Figures = Readonly<Record<FigureName, string>>;

export const FIGURE_TOKEN = /%(VITE_\w+)%/g;

const isFigureName = (name: string): name is FigureName => (FIGURE_NAMES as readonly string[]).includes(name);

export function substituteFigures(
  text: string,
  figures: Readonly<Record<string, string | undefined>>,
  where: string,
): string {
  return text.replace(FIGURE_TOKEN, (raw, name: string) => {
    if (!isFigureName(name)) throw new Error(`${where}: ${raw} is not a published figure (${FIGURE_NAMES.join(', ')})`);
    const value = figures[name];
    if (value === undefined || value === '') throw new Error(`${where}: ${raw} has no value — publishBuildEnv did not run`);
    return value;
  });
}
