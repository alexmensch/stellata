// Reads vitest's JSON report and names every test that did not run: a skip, pending or todo.

export interface VitestJsonReport {
  numTotalTests: number;
  testResults: { name: string; assertionResults: { fullName: string; status: string }[] }[];
}

const RAN = new Set(['passed', 'failed']);

export function testsNotRun(report: VitestJsonReport, root: string): string[] {
  return report.testResults.flatMap((file) =>
    file.assertionResults
      .filter((test) => !RAN.has(test.status))
      .map((test) => `${test.status.toUpperCase()} ${file.name.replace(`${root}/`, '')} › ${test.fullName}`),
  );
}
