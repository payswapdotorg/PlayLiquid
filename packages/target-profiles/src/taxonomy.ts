/**
 * The frozen target taxonomy (spec/architecture.md "Build" targets) and
 * the R12 workflow-class mapping.
 *
 * R12: "Builds support web, desktop, mobile, XR, dedicated server and
 * console workflows where toolchains permit." The workflow classes are
 * the six R12 workflows; every target in the frozen taxonomy maps to
 * exactly one. The taxonomy is FROZEN: adding or removing a target is an
 * Architecture Change Request, never a local edit.
 */

/** The frozen target taxonomy — exactly the architecture's Build targets. */
export const TARGETS = Object.freeze([
  "web",
  "spark",
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
  "steamdeck",
  "xr",
  "dedicated-server",
  "console",
] as const);

/** A target id. */
export type TargetId = (typeof TARGETS)[number];

/** Type guard: a known target. */
export function isTargetId(value: unknown): value is TargetId {
  return typeof value === "string" && (TARGETS as readonly string[]).includes(value);
}

/** The six R12 workflow classes. */
export const WORKFLOW_CLASSES = Object.freeze([
  "web",
  "desktop",
  "mobile",
  "xr",
  "dedicated-server",
  "console",
] as const);

/** An R12 workflow class. */
export type TargetWorkflowClass = (typeof WORKFLOW_CLASSES)[number];

/** Type guard: a known workflow class. */
export function isWorkflowClass(value: unknown): value is TargetWorkflowClass {
  return typeof value === "string" && (WORKFLOW_CLASSES as readonly string[]).includes(value);
}

/**
 * The frozen target → workflow-class table (R12). Notes:
 * - `spark` maps to the MOBILE workflow: R6 defines Spark as a 9:16
 *   mobile-first fast-start target (a target profile, not a content
 *   model — lock rule 16);
 * - `steamdeck` maps to the DESKTOP workflow (handheld PC class);
 * - `console` maps to the CONSOLE workflow, whose builds are vendor
 *   SDK/toolchain gated and must be proven (lock rule 24).
 */
export const TARGET_WORKFLOW_CLASSES: Readonly<Record<TargetId, TargetWorkflowClass>> = Object.freeze({
  web: "web",
  spark: "mobile",
  windows: "desktop",
  macos: "desktop",
  linux: "desktop",
  android: "mobile",
  ios: "mobile",
  steamdeck: "desktop",
  xr: "xr",
  "dedicated-server": "dedicated-server",
  console: "console",
});

/** The R12 workflow class of a target (pure table lookup, total). */
export function targetWorkflowClass(target: TargetId): TargetWorkflowClass {
  return TARGET_WORKFLOW_CLASSES[target];
}

/** Every target of one workflow class, in taxonomy order. */
export function targetsOfWorkflowClass(workflowClass: TargetWorkflowClass): readonly TargetId[] {
  return TARGETS.filter((target) => TARGET_WORKFLOW_CLASSES[target] === workflowClass);
}
