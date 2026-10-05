/**
 * CROSS-CAPABILITY COMPOSITION RULES (lock rule 18 enforcement at the type
 * AND policy layer) — the PL-004 keystone module.
 *
 * `validateCapabilityPolicy(policy) -> { pass, reasons[] }` is the PURE
 * proof that a game's platform policy declares events and policies ONLY,
 * and cannot re-declare platform authorities:
 *
 * - games bind THEIR declared semantic events to capabilities
 *   ({@link CapabilityEventBinding}); bindings for capabilities or events
 *   the game never declared are refused;
 * - the reserved `platform.` event namespace is refused for game-declared
 *   events (`reserved-platform-event-kind`) — games cannot mint platform
 *   authority events (lock 18);
 * - rewards declarations must keep rewards platform-settled
 *   (`client-authoritative-rewards`, lock 41);
 * - protected multiplayer outcomes under peer-to-peer topology are
 *   refused (`competitive-p2p-topology`, lock 19 — a cross-capability
 *   composition rule: the multiplayer declaration is checked against the
 *   game's protected-outcome event bindings);
 * - tenancy scope must be a well-formed declaration (R20).
 *
 * Mutable state owner: none — this module is a pure function. The
 * platform policy service (later Work Order) owns admission of validated
 * policies into runtime state.
 */

import {
  findPlatformCapability,
  isPlatformCapabilitySet,
  isRewardsPolicy,
} from "@playliquid/game-contracts";
import type { GameId, PlatformCapabilitySet } from "@playliquid/game-contracts";
import {
  isGameSemanticEventDeclaration,
  isReservedPlatformEventKind,
  isValidEventKindText,
} from "./events.ts";
import type { GameSemanticEventDeclaration } from "./events.ts";
import { isTenantScopeDeclaration } from "./tenancy.ts";
import type { TenantScopeDeclaration } from "./tenancy.ts";
import { isLeaderboardEventBinding } from "./leaderboard.ts";
import type { LeaderboardEventBinding } from "./leaderboard.ts";
import { isMultiplayerEventBinding } from "./multiplayer.ts";
import type { MultiplayerEventBinding } from "./multiplayer.ts";
import { isReplayEventBinding } from "./replay.ts";
import type { ReplayEventBinding } from "./replay.ts";
import { isRewardRuleBinding } from "./entitlements.ts";
import type { RewardRuleBinding } from "./entitlements.ts";
import { isAchievementEventBinding } from "./achievements.ts";
import type { AchievementEventBinding } from "./achievements.ts";
import { isSocialEventBinding } from "./social.ts";
import type { SocialEventBinding } from "./social.ts";
import { isAnalyticsEventBinding } from "./analytics.ts";
import type { AnalyticsEventBinding } from "./analytics.ts";
import { isModerationEventBinding } from "./moderation.ts";
import type { ModerationEventBinding } from "./moderation.ts";
import { isIntegrityEventBinding } from "./integrity.ts";
import type { IntegrityEventBinding } from "./integrity.ts";

/**
 * The union of every per-capability event binding a game may declare.
 * Discriminated on `capability`, so a binding for one capability is
 * never assignable where another's is required.
 */
export type CapabilityEventBinding =
  | LeaderboardEventBinding
  | MultiplayerEventBinding
  | ReplayEventBinding
  | RewardRuleBinding
  | AchievementEventBinding
  | SocialEventBinding
  | AnalyticsEventBinding
  | ModerationEventBinding
  | IntegrityEventBinding;

/** A game's complete platform policy declaration. */
export interface PlatformPolicyDeclaration {
  readonly game: GameId;
  readonly capabilities: PlatformCapabilitySet;
  readonly events: readonly GameSemanticEventDeclaration[];
  readonly bindings: readonly CapabilityEventBinding[];
  readonly tenancy: TenantScopeDeclaration;
}

/** One typed rejection reason. `detail` names the offending item. */
export interface PolicyRejectionReason {
  readonly code:
    | "invalid-capability-set"
    | "client-authoritative-rewards"
    | "duplicate-event-kind"
    | "reserved-platform-event-kind"
    | "malformed-event-declaration"
    | "malformed-binding"
    | "duplicate-binding"
    | "binding-for-undeclared-capability"
    | "binding-for-undeclared-event"
    | "competitive-p2p-topology"
    | "invalid-tenancy-scope";
  readonly detail: string;
}

/** The validator's result shape: `{ pass, reasons[] }`. */
export interface CapabilityPolicyValidation {
  readonly pass: boolean;
  readonly reasons: readonly PolicyRejectionReason[];
}

/** Returns true when `value` is any well-formed {@link CapabilityEventBinding}. */
export function isCapabilityEventBinding(value: unknown): value is CapabilityEventBinding {
  return (
    isLeaderboardEventBinding(value) ||
    isMultiplayerEventBinding(value) ||
    isReplayEventBinding(value) ||
    isRewardRuleBinding(value) ||
    isAchievementEventBinding(value) ||
    isSocialEventBinding(value) ||
    isAnalyticsEventBinding(value) ||
    isModerationEventBinding(value) ||
    isIntegrityEventBinding(value)
  );
}

/** Structural guard for {@link PlatformPolicyDeclaration}. */
export function isPlatformPolicyDeclaration(value: unknown): value is PlatformPolicyDeclaration {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  if (typeof policy.game !== "string" || policy.game.length === 0) return false;
  if (!Array.isArray(policy.capabilities)) return false;
  if (!Array.isArray(policy.events)) return false;
  if (!Array.isArray(policy.bindings)) return false;
  if (!policy.events.every((declaration) => isGameSemanticEventDeclaration(declaration))) return false;
  if (!policy.bindings.every((binding) => isCapabilityEventBinding(binding))) return false;
  return isTenantScopeDeclaration(policy.tenancy);
}

function bindingGuardFor(capability: string): ((value: unknown) => boolean) | undefined {
  switch (capability) {
    case "leaderboard":
      return isLeaderboardEventBinding;
    case "multiplayer":
      return isMultiplayerEventBinding;
    case "replay":
      return isReplayEventBinding;
    case "rewards":
      return isRewardRuleBinding;
    case "achievements":
      return isAchievementEventBinding;
    case "social":
      return isSocialEventBinding;
    case "analytics":
      return isAnalyticsEventBinding;
    case "moderation":
      return isModerationEventBinding;
    case "integrity":
      return isIntegrityEventBinding;
    default:
      return undefined;
  }
}

/**
 * THE cross-capability policy validator (pure). Every reason is typed and
 * names its offender in `detail`; a passing policy has `pass: true` and
 * an empty `reasons` array.
 */
export function validateCapabilityPolicy(policy: PlatformPolicyDeclaration): CapabilityPolicyValidation {
  const reasons: PolicyRejectionReason[] = [];

  // 1. Capability set must be a valid, duplicate-free set of descriptors.
  if (!isPlatformCapabilitySet(policy.capabilities)) {
    reasons.push({ code: "invalid-capability-set", detail: "capabilities are not a valid PlatformCapabilitySet" });
  }

  // 2. Lock 41: rewards stay platform-settled — the rewards descriptor's
  // policy must be a valid RewardsPolicy (clientAuthoritative: false).
  const rewardsDescriptor = findPlatformCapability(policy.capabilities, "rewards");
  if (
    rewardsDescriptor !== undefined &&
    rewardsDescriptor.capability === "rewards" &&
    !isRewardsPolicy(rewardsDescriptor.policy)
  ) {
    reasons.push({
      code: "client-authoritative-rewards",
      detail: "rewards policy must be platform-settled (clientAuthoritative: false)",
    });
  }

  // 3. Event declarations: shape, duplicate kinds, reserved namespace.
  const declaredKinds = new Set<string>();
  for (const declaration of policy.events) {
    if (!isGameSemanticEventDeclaration(declaration)) {
      const label = declaration as { kind?: unknown };
      const detail = typeof label.kind === "string" ? label.kind : "<unnamed>";
      reasons.push({ code: "malformed-event-declaration", detail });
      continue;
    }
    const kind: string = declaration.kind;
    if (!isValidEventKindText(kind)) {
      reasons.push({ code: "malformed-event-declaration", detail: kind });
      continue;
    }
    if (isReservedPlatformEventKind(kind)) {
      reasons.push({ code: "reserved-platform-event-kind", detail: kind });
      continue;
    }
    if (declaredKinds.has(kind)) {
      reasons.push({ code: "duplicate-event-kind", detail: kind });
      continue;
    }
    declaredKinds.add(kind);
  }

  // 4. Bindings: shape, declared capability, declared event, duplicates.
  const declaredCapabilities = new Set(policy.capabilities.map((descriptor) => descriptor.capability));
  const seenBindings = new Set<string>();
  for (const binding of policy.bindings) {
    const guard = bindingGuardFor(binding.capability);
    if (guard === undefined || !guard(binding)) {
      reasons.push({ code: "malformed-binding", detail: `${binding.capability}:${String(binding.eventKind)}` });
      continue;
    }
    const eventKind: string = binding.eventKind;
    if (!declaredCapabilities.has(binding.capability)) {
      reasons.push({ code: "binding-for-undeclared-capability", detail: `${binding.capability}:${eventKind}` });
      continue;
    }
    if (!declaredKinds.has(eventKind)) {
      reasons.push({ code: "binding-for-undeclared-event", detail: `${binding.capability}:${eventKind}` });
      continue;
    }
    const bindingKey = `${binding.capability}:${eventKind}`;
    if (seenBindings.has(bindingKey)) {
      reasons.push({ code: "duplicate-binding", detail: bindingKey });
      continue;
    }
    seenBindings.add(bindingKey);
  }

  // 5. Lock 19 cross-capability rule: protected multiplayer outcomes
  // require an authoritative topology. Peer-to-peer with protected
  // bindings is refused.
  const multiplayerDescriptor = findPlatformCapability(policy.capabilities, "multiplayer");
  if (
    multiplayerDescriptor !== undefined &&
    multiplayerDescriptor.capability === "multiplayer" &&
    multiplayerDescriptor.policy.topology === "peer-to-peer"
  ) {
    const protectedBinding = policy.bindings.find(
      (binding): binding is MultiplayerEventBinding =>
        binding.capability === "multiplayer" && binding.outcomeClassification === "protected",
    );
    if (protectedBinding !== undefined) {
      reasons.push({
        code: "competitive-p2p-topology",
        detail: `protected outcome event ${String(protectedBinding.eventKind)} under peer-to-peer topology`,
      });
    }
  }

  // 6. Tenancy scope declaration must be well-formed (R20).
  if (!isTenantScopeDeclaration(policy.tenancy)) {
    reasons.push({ code: "invalid-tenancy-scope", detail: "tenancy is not a valid TenantScopeDeclaration" });
  }

  return { pass: reasons.length === 0, reasons };
}
