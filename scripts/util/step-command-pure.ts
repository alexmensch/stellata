// The command that runs a pipeline step, as every hint and refusal names it.

export const rerunCommand = (step: string): string => `pnpm run ${step}`;
