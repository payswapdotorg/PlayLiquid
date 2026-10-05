/**
 * Public barrel of `@playliquid/game-ir` — the engine-independent semantic
 * kernel (lock rule 1). Imports `@playliquid/game-contracts` only, per the
 * module dependency matrix.
 */

export {
  GAME_IR_VALUE_KINDS,
  FORBIDDEN_RECORD_KEYS,
  MAX_VALUE_DEPTH,
  MAX_LIST_LENGTH,
  MAX_RECORD_FIELDS,
  isGameIRValueKind,
  isGameIRValue,
  gameIRValueKind,
} from "./values.ts";
export type { GameIRValue, GameIRValueKind } from "./values.ts";
export { isValueShape, valueMatchesShape } from "./shapes.ts";
export type { ValueShape } from "./shapes.ts";
export {
  isSemanticTick,
  isValidTypeIdText,
  asEventTypeId,
  asIntentTypeId,
  asCommandTypeId,
} from "./semantics.ts";
export type {
  SemanticTick,
  EventTypeId,
  IntentTypeId,
  CommandTypeId,
  AgentRef,
  GameEvent,
  Intent,
  Command,
  IntentAdjudicator,
} from "./semantics.ts";
export { GAME_IR_NODE_KINDS, asNodeId, isGameIRNodeKind } from "./nodes.ts";
export type {
  NodeId,
  NodeKind,
  WorldNode,
  SceneNode,
  EntityNode,
  RuleNode,
  EventDeclarationNode,
  CapabilityDeclarationNode,
  AvatarBindingNode,
  GameIRNode,
} from "./nodes.ts";
export { GAME_IR_VERSION, isGameIRVersion } from "./document.ts";
export type { GameIRVersion, GameIRDocument } from "./document.ts";
export { error, warning, hasErrors } from "./diagnostics.ts";
export type { DiagnosticSeverity, DiagnosticCode, Diagnostic, ValidationOk, ValidationFail, ValidationResult } from "./diagnostics.ts";
export {
  canonicalFloatForm,
  canonicalValueForm,
  gameIRValuesEqual,
  hashGameIRValue,
  canonicalIntentForm,
  canonicalCommandForm,
  canonicalEventForm,
  hashIntent,
  hashCommand,
  hashEvent,
  verifySimulationStepDeterminism,
} from "./evaluate.ts";
export type {
  DeterministicEvaluator,
  SimulationStepInput,
  SimulationStepOutput,
  SimulationStep,
} from "./evaluate.ts";
export { validate, isGameIRDocument, validationErrors, countNodeKinds } from "./validate.ts";
