/**
 * Public barrel of `@playliquid/lab-organization` — the organization
 * compiler/search of the Game Engineering Lab (Work Order PL-029).
 *
 * Imports `@playliquid/lab-contracts`, `@playliquid/avatar-runtime`,
 * `@playliquid/lab-simulation` and the frozen id/tenancy vocabulary
 * (`@playliquid/game-contracts`, `@playliquid/platform-contracts`,
 * `@playliquid/package-system`) per spec/work-items.md (Depends: PL-006,
 * PL-026, PL-028) and spec/module-dependency-matrix.md. Fakes and the
 * harness are deliberately NOT part of the public surface (house pattern
 * of lab-simulation): hosts inject their own ports (ports.ts).
 *
 * Module map:
 * - records.ts        typed record vocabulary + refusal-code unions
 * - digest.ts         content-addressed identity helpers
 * - compile.ts        the total organization compiler + simulation projection
 * - space.ts          the bounded candidate-space model
 * - generate.ts       blueprint → descriptor generation (space index → org)
 * - search.ts         the seeded deterministic traversal
 * - evaluation.ts     compile → lab-simulation → immutable evidence wiring
 * - gaps.ts          capability-gap awareness (frozen ladder consumption)
 * - ports.ts          injected ports + stored-document shapes
 * - service-types.ts  service door types
 * - sessions.ts       search admission + cursor-paging oracles (internal)
 * - document.ts       content-addressed service-document snapshots (internal)
 * - views.ts          service door view constructors (internal)
 * - service.ts        LabOrganizationService — the state owner (E1)
 */

// Records — the typed vocabulary
export {
  ROLE_ASSIGNMENTS,
  BODY_BINDINGS,
  MODEL_ROUTINGS,
  TOOL_SETS,
  CAPABILITY_SPREADS,
  TOPOLOGY_PRESETS,
  MEMORY_PRESETS,
  BUDGET_PRESETS,
  REVIEW_PRESETS,
  MAX_SEARCH_AGENT_COUNT,
  MAX_ROLE_VOCABULARY,
  MAX_BODY_CATALOG,
  MAX_MODEL_CATALOG,
  MAX_TOOL_CATALOG,
  MAX_CAPABILITY_VOCABULARY,
  MAX_SEARCH_SPACE,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  isSearchCursor,
  isCandidateBlueprint,
} from "./records.ts";
export type {
  RoleAssignment,
  BodyBinding,
  ModelRouting,
  ToolSet,
  CapabilitySpread,
  TopologyPreset,
  MemoryPreset,
  BudgetPreset,
  ReviewPreset,
  SearchDimensionBounds,
  OrganizationSearchRequest,
  CandidateSpaceAxis,
  CandidateSpace,
  SearchCursor,
  CandidateBlueprint,
  SearchedCandidate,
  CompiledBodySlot,
  CompiledAgentSlot,
  CompiledAgentCapabilities,
  CompiledTopologyEdge,
  CompiledOrganization,
  CompileRefusalCode,
  CompileRejection,
  SearchOpenRefusalCode,
  SearchPageRefusalCode,
  EvaluateRefusalCode,
  GapDoorRefusalCode,
} from "./records.ts";

// Digest — content-addressed identity
export {
  jsonSafeOf,
  organizationDigestOf,
  searchIdentityDigest,
  searchSlugId,
  candidateDigestOf,
  asSlugOrganizationId,
  baselineOrganizationId,
  candidateOrganizationId,
  evaluationContentKeyOf,
  asGapSlugId,
  gapSlugId,
  gapFindingDigestOf,
  asEvaluationSlugId,
} from "./digest.ts";

// Compile — the total compiler
export { compileOrganization, labEvaluationRequestOf } from "./compile.ts";
export type { BodyCatalogPort, ToolCatalogPort, CompilePorts, CompileOptions, CompileResult, LabEvaluationRequestInput } from "./compile.ts";

// Space — the bounded candidate space
export { canonicalizeBounds, computeSpace, pageSizeOf, decodeBlueprint } from "./space.ts";
export type { BoundsResult, SpaceResult } from "./space.ts";

// Generate — blueprint → descriptor
export { candidateAtSpaceIndex } from "./generate.ts";

// Search — the seeded traversal
export { traversalOf, spaceIndexOf, candidateAtPosition, baselinePositionOf, enumerateTraversal } from "./search.ts";
export type { SearchTraversal } from "./search.ts";

// Evaluation — compile → lab-simulation → immutable evidence
export { evaluateThroughPort } from "./evaluation.ts";
export type { EvaluateThroughPortInput, EvaluateThroughPortResult } from "./evaluation.ts";

// Gaps — capability-gap awareness (frozen ladder consumption)
export { detectCapabilityGaps, openGapFromFinding, advanceGapResolution, asGapRecordId } from "./gaps.ts";
export type { CapabilityGapFinding, OpenGapInput, OpenGapResult, GapAdvanceResult } from "./gaps.ts";

// Ports — the host seams
export type {
  LabOrganizationClockPort,
  LabEvaluationPort,
  LabOrganizationCaller,
  StoredSearch,
  StoredCompilation,
  StoredCandidateEvidence,
  StoredCapabilityGap,
  LabOrganizationDocument,
  LabOrganizationStore,
  LabOrganizationPorts,
} from "./ports.ts";

// Service — the state owner
export { LabOrganizationService } from "./service.ts";
export type { LabOrganizationServiceOptions } from "./service.ts";
export type {
  CompileDoorResult,
  SearchOpenResult,
  SearchPageResult,
  EvaluateDoorResult,
  GapAdvanceDoorResult,
  CompilationReadResult,
  GapReadResult,
  EvaluateCandidateDoorInput,
  EvaluateOrganizationDoorInput,
  GapAdvanceDoorInput,
} from "./service-types.ts";
