// Where the pipeline's build-only hand-offs land, repo-relative. See README.md.

export const BUILD_FILES = {
  catalogRowIndexMap: 'build/catalog-row-index-map.json',
  bindingVerdicts: 'build/binding-integrity-verdicts.tsv',
} as const;
