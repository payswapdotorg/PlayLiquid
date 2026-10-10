/**
 * THE METRIC MODEL (PL-028) — the frozen mapping from run statistics to
 * suite metric readings.
 *
 * Honest vocabulary discipline (E11): a suite metric outside
 * {@link LAB_METRIC_IDS} is REFUSED (`unmeasurable-metric`) — the
 * simulator never fabricates a reading for a quantity it does not model;
 * a suite declaring non-scalar shapes is refused the same way. Every
 * produced reading is a kernel scalar value tagged by the suite shape.
 *
 * Pure module: total functions of their inputs.
 */

import type { EvaluationMetricReading, LabEvaluationSuite } from "@playliquid/lab-contracts";
import type { LabRunStatistics } from "./records.ts";
import { LAB_METRIC_IDS } from "./records.ts";
import type { LabScenario } from "./scenario.ts";

/** The frozen statistic a metric id reads (undefined = unmodeled). */
function metricValueOf(statistics: LabRunStatistics, metricId: string, capabilityCoverage: number): number | undefined {
  switch (metricId) {
    case LAB_METRIC_IDS.completedWork:
      return statistics.completedWork;
    case LAB_METRIC_IDS.progressUnits:
      return statistics.progressUnits;
    case LAB_METRIC_IDS.estimatedThroughput:
      return statistics.ticks > 0 ? statistics.progressUnits / statistics.ticks : 0;
    case LAB_METRIC_IDS.defectsIntroduced:
      return statistics.defects;
    case LAB_METRIC_IDS.defectDensity:
      return statistics.progressUnits > 0 ? statistics.defects / statistics.progressUnits : 0;
    case LAB_METRIC_IDS.intentDenials:
      return statistics.brokerDenials;
    case LAB_METRIC_IDS.commandsAdmitted:
      return statistics.commandsAdmitted;
    case LAB_METRIC_IDS.capabilityCoverage:
      return capabilityCoverage;
    default:
      return undefined;
  }
}

/** Maps statistics onto suite metric readings (honest vocabulary check). */
export function readingsOf(
  statistics: LabRunStatistics,
  suite: LabEvaluationSuite,
  scenario: LabScenario,
): { readonly ok: true; readonly payload: readonly EvaluationMetricReading[] } | { readonly ok: false; readonly code: "unmeasurable-metric"; readonly detail: string } {
  const privileged = scenario.agents.filter((agent) => !agent.unprivileged).length;
  const capabilityCoverage = scenario.agents.length > 0 ? privileged / scenario.agents.length : 0;
  const readings: EvaluationMetricReading[] = [];
  for (const metric of suite.metrics) {
    const value = metricValueOf(statistics, String(metric.metricId), capabilityCoverage);
    if (value === undefined) {
      return {
        ok: false,
        code: "unmeasurable-metric",
        detail: `suite metric ${String(metric.metricId)} is outside the simulator's model vocabulary (LAB_METRIC_IDS) — the simulator never fabricates readings (E11)`,
      };
    }
    if (metric.shape.kind === "int") {
      readings.push({ metricId: metric.metricId, value: { kind: "int", value: BigInt(Math.round(value)) } });
    } else if (metric.shape.kind === "float") {
      readings.push({ metricId: metric.metricId, value: { kind: "float", value } });
    } else {
      return {
        ok: false,
        code: "unmeasurable-metric",
        detail: `suite metric ${String(metric.metricId)} declares shape kind ${metric.shape.kind}; the simulator only produces scalar int/float readings`,
      };
    }
  }
  if (readings.length === 0) {
    return { ok: false, code: "unmeasurable-metric", detail: "suite declares no metrics — an evaluation without readings is not an evaluation" };
  }
  return { ok: true, payload: readings };
}
