/**
 * qa/performance — BASELINE REPORT RUNNER (PL-042).
 *
 * Regenerates the committed baseline evidence under reports/ from the
 * SAME measurement functions the tests assert (`node run-baselines.ts`
 * from qa/performance; no flags, no network, no child processes):
 *
 * - reports/baseline-<suite>.json — the environment header (node
 *   version, platform, cpus, memory), every measured metric with its
 *   ENFORCED budget (from src/budgets.ts, the single source of truth),
 *   the workload shape digest and the determinism repeat digest;
 * - reports/README.md — the human summary table.
 *
 * HONESTY (E11): the numbers in reports/ are ONE machine's wall-clock
 * measurements of the exactly-described workloads — the budget, not the
 * measurement, is the contract. Re-running this script on another box
 * regenerates honest numbers for THAT box; the shape digests and the
 * budget assertions are what must hold everywhere.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  measureEngine,
  measureLargeWorld,
  measureReplay,
  measureSimulation,
  environmentHeader,
} from "./src/index.ts";

interface SuiteReport {
  readonly suite: string;
  readonly generatedAt: string;
  readonly environment: Record<string, string | number>;
  readonly workload: {
    readonly description: string;
    readonly shapeDigest: string;
    readonly determinism: { readonly repeated: boolean; readonly digest: string };
  };
  readonly metrics: readonly {
    readonly metric: string;
    readonly scale: string;
    readonly count: number;
    readonly measured: number;
    readonly unit: string;
    readonly budget: number;
    readonly withinBudget: boolean;
    readonly opsPerSecond?: number;
    readonly detail?: string;
  }[];
}

const SUITE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  simulation: "PL-014 Simulation Runtime: 500 sessions x (create + seeded load + 20 steps) + one deep 10,000-tick session, over the demo binding with fixed clocks.",
  replay: "PL-014 replay command streams: 50 artifacts x 200 recorded broker-mediated move commands sealed and verified; 1,000 tampered-digest verifications (typed refusals).",
  "large-world": "PL-039 LATTICE: one full world composition (87 packages through registry/CAS), a 240-tick moving-viewpoint streaming schedule, and wanted-set derivation at 4 radii x 289 positions.",
  engine: "PL-021 PlayCanvas adapter: 2,000 typed engine-binding constructions and a 2,000-command inspect/modify plan applied through the deterministic fake bridge (E11 test host).",
};

async function main(): Promise<void> {
  const reportsDir = path.resolve("reports");
  await mkdir(reportsDir, { recursive: true });

  const simulation = measureSimulation();
  const replay = measureReplay();
  const largeWorld = await measureLargeWorld();
  const engine = await measureEngine();
  const suites = [simulation, replay, largeWorld, engine];

  const reports: SuiteReport[] = [];
  for (const suite of suites) {
    const report: SuiteReport = {
      suite: suite.suite,
      generatedAt: new Date().toISOString(),
      environment: environmentHeader(),
      workload: {
        description: SUITE_DESCRIPTIONS[suite.suite] ?? "",
        shapeDigest: suite.shapeDigest,
        determinism: suite.determinism,
      },
      metrics: suite.metrics.map((metric) => ({
        metric: metric.metric,
        scale: metric.scale,
        count: metric.count,
        measured: Math.round(metric.measuredMs * 100) / 100,
        unit: metric.unit ?? "ms",
        budget: metric.budgetMs,
        withinBudget: metric.measuredMs < metric.budgetMs,
        ...(metric.unit === undefined || metric.unit === "ms"
          ? { opsPerSecond: Math.round((metric.count * 1000) / Math.max(metric.measuredMs, 0.001)) }
          : {}),
        ...(metric.detail === undefined ? {} : { detail: metric.detail }),
      })),
    };
    if (report.metrics.some((metric) => !metric.withinBudget)) {
      throw new Error(`${suite.suite}: a metric exceeded its budget — refusing to write a failing baseline`);
    }
    const file = path.join(reportsDir, `baseline-${suite.suite}.json`);
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    reports.push(report);
    console.log(`[baselines] wrote ${path.relative(process.cwd(), file)}`);
  }

  const readme = renderReadme(reports);
  const readmeFile = path.join(reportsDir, "README.md");
  await writeFile(readmeFile, readme, "utf8");
  console.log(`[baselines] wrote ${path.relative(process.cwd(), readmeFile)}`);
}

function renderReadme(reports: readonly SuiteReport[]): string {
  const lines: string[] = [
    "# qa/performance — committed baseline reports (PL-042)",
    "",
    "One machine's honest wall-clock measurements of the cross-system scale",
    "suite (regenerate with `node run-baselines.ts` from qa/performance). The",
    "workload SHAPE digests prove the workloads are deterministic; the timings",
    "are machine-dependent evidence, and the ENFORCED BUDGET (from",
    "`src/budgets.ts`, the single source of truth) is the contract every test",
    "asserts. No extrapolated claims: each metric names exactly what ran.",
    "",
  ];
  for (const report of reports) {
    lines.push(`## ${report.suite}`);
    lines.push("");
    lines.push(`- **Environment**: ${String(report.environment.nodeVersion)}, ${String(report.environment.platform)}, ${String(report.environment.cpus)} cpus (${String(report.environment.cpuModel)}), ${String(report.environment.totalMemoryMb)}MB RAM`);
    lines.push(`- **Workload**: ${report.workload.description}`);
    lines.push(`- **Workload shape digest**: \`${report.workload.shapeDigest}\``);
    lines.push(`- **Determinism repeat digest**: \`${report.workload.determinism.digest}\``);
    lines.push("");
    lines.push("| metric | scale | measured | budget | within |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const metric of report.metrics) {
      lines.push(`| ${metric.metric} | ${metric.scale} | ${String(metric.measured)} ${metric.unit} | ${String(metric.budget)} ${metric.unit} | ${metric.withinBudget ? "yes" : "NO"} |`);
    }
    lines.push("");
  }
  lines.push("## Honesty notes (E11)");
  lines.push("");
  lines.push("- Timings are wall-clock on the generating machine (`performance.now()`);");
  lines.push("  heap figures are `process.memoryUsage()` deltas without forced GC.");
  lines.push("- The build-orchestrator-style tool execution is NOT measured here: the");
  lines.push("  engine suite runs over the deterministic in-memory fake bridge (the");
  lines.push("  labeled test host), so it bounds the adapter/orchestration cost only.");
  lines.push("- Budgets live in `src/budgets.ts` (~3-10x observed, rounded): they exist");
  lines.push("  to catch order-of-magnitude regressions, never percentage points.");
  return `${lines.join("\n")}\n`;
}

await main();
