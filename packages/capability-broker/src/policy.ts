/**
 * BROKER POLICY: what the Capability Broker may ever admit, and how a
 * granted intent kind becomes a canonical command kind.
 *
 * The policy is the GAME side of lock rule 4's boundary (lock 4: the broker
 * is THE runtime authorization boundary). It has exactly two inputs, both
 * authoritative:
 *
 * 1. The game's GameIR document (the semantic kernel — lock rule 1). This
 *    module derives host restrictions from `avatar-binding` nodes (R5:
 *    host games restrict avatar capabilities) and the set of intent kinds
 *    the world's `rule` nodes can actually handle. A capability coverage
 *    that references an intent kind NO rule handles is refused: granting it
 *    would mint commands no authoritative system could adjudicate.
 * 2. The game's explicit capability coverage declaration: which capability
 *    (semantic permission name) covers which intent kinds, and which
 *    command kind a derived command carries per intent kind.
 *
 * The bridge from the game-contracts avatar capability vocabulary
 * (sensor/actuator ids such as `movement`) into the runtime capability id
 * space (runtime-contracts `CapabilityId`) is the frozen deterministic
 * convention {@link avatarCapabilityId}: `avatar.<capability>`.
 *
 * Pure module: no IO, no clock, no randomness. `sandboxed` host
 * restrictions are NOT consumed here — sandboxing is an adapter/host
 * execution concern, not a permission decision (scope discipline).
 */

import { isValidTypeIdText } from "@playliquid/game-ir";
import type { AvatarBindingNode, GameIRDocument, RuleNode } from "@playliquid/game-ir";
import {
  asCapabilityId,
  asCommandKind,
  asIntentKind,
} from "@playliquid/runtime-contracts";
import type { CapabilityId, CommandKind, IntentKind } from "@playliquid/runtime-contracts";

/** Avatar capability id as it appears inside GameIR host restrictions. */
export type AvatarRestrictionCapability = AvatarBindingNode["restrictions"]["denied"][number];

/**
 * The frozen bridge from the game-contracts avatar capability vocabulary to
 * the runtime capability id space: `avatar.<capability>`.
 */
export function avatarCapabilityId(capability: AvatarRestrictionCapability): CapabilityId {
  return asCapabilityId(`avatar.${capability}`);
}

/** Host restrictions the broker enforces at grant admission (R5, R20). */
export interface BrokerRestrictions {
  /** Capabilities the host denies outright; grants for them are refused. */
  readonly denied: readonly CapabilityId[];
  /** Capabilities admitted only with an explicit host approval marker. */
  readonly approvalRequired: readonly CapabilityId[];
}

/** What the broker may ever admit and how granted intents derive commands. */
export interface BrokerPolicy {
  /** capabilityId -> intent kinds the capability authorizes (coverage). */
  readonly capabilityIntentKinds: Readonly<Record<string, readonly IntentKind[]>>;
  /** intent kind -> command kind string the derived command carries. */
  readonly intentCommandKinds: Readonly<Record<string, string>>;
  readonly restrictions: BrokerRestrictions;
}

/** One game declaration: a capability, the intents it covers, their commands. */
export interface CapabilityCoverageDeclaration {
  readonly capability: CapabilityId;
  readonly intentKinds: readonly string[];
  /** intent kind text -> command kind text (must cover every intent kind). */
  readonly commandKindByIntent: Readonly<Record<string, string>>;
}

/** Typed derivation failure. Errors are total: no policy is produced. */
export type PolicyDerivationResult =
  | { readonly ok: true; readonly policy: BrokerPolicy }
  | { readonly ok: false; readonly code: PolicyErrorCode; readonly detail: string };

export type PolicyErrorCode =
  | "duplicate-capability"
  | "invalid-intent-kind"
  | "intent-without-command-kind"
  | "intent-not-handled-by-rules"
  | "invalid-restriction-target";

/**
 * Derive the broker policy from a GameIR document plus the game's explicit
 * capability coverage declaration. Rules (all fail-closed):
 *
 * - capability ids in the coverage must be unique;
 * - every declared intent kind must be valid type-id text (game-ir rules);
 * - every declared intent kind must have a command kind mapping;
 * - every declared intent kind must be handled by at least one `rule` node
 *   of the document (unadjudicatable intents can never be granted);
 * - `avatar-binding` restrictions are collected and bridged into the
 *   capability id space via {@link avatarCapabilityId}.
 */
export function deriveBrokerPolicy(
  document: GameIRDocument,
  coverage: readonly CapabilityCoverageDeclaration[],
): PolicyDerivationResult {
  const handled = collectHandledIntentKinds(document);
  const capabilityIntentKinds: Record<string, readonly IntentKind[]> = {};
  const intentCommandKinds: Record<string, string> = {};

  for (const declaration of coverage) {
    const key = String(declaration.capability);
    if (capabilityIntentKinds[key] !== undefined) {
      return fail("duplicate-capability", `capability ${key} declared twice`);
    }
    const kinds: IntentKind[] = [];
    for (const intentKindText of declaration.intentKinds) {
      const reason = checkIntentKind(intentKindText, declaration, handled, intentCommandKinds);
      if (reason !== undefined) {
        return fail(reason.code, `${key}: ${reason.detail}`);
      }
      const intentKind = asIntentKind(intentKindText);
      kinds.push(intentKind);
      intentCommandKinds[intentKindText] = declaration.commandKindByIntent[intentKindText] as string;
    }
    capabilityIntentKinds[key] = kinds;
  }

  return {
    ok: true,
    policy: {
      capabilityIntentKinds,
      intentCommandKinds,
      restrictions: deriveRestrictions(document),
    },
  };
}

/**
 * Build a broker policy directly (no GameIR document). Same validation as
 * {@link deriveBrokerPolicy} minus the rule-node coverage check, which only
 * a document can answer. Used by hosts that compose the broker from
 * already-validated game declarations (and by the GrantTable-compatible
 * test double in fakes.ts).
 */
export function brokerPolicy(
  coverage: readonly CapabilityCoverageDeclaration[],
  restrictions: BrokerRestrictions = { denied: [], approvalRequired: [] },
): PolicyDerivationResult {
  const capabilityIntentKinds: Record<string, readonly IntentKind[]> = {};
  const intentCommandKinds: Record<string, string> = {};
  for (const declaration of coverage) {
    const key = String(declaration.capability);
    if (capabilityIntentKinds[key] !== undefined) {
      return fail("duplicate-capability", `capability ${key} declared twice`);
    }
    const kinds: IntentKind[] = [];
    for (const intentKindText of declaration.intentKinds) {
      if (!isValidTypeIdText(intentKindText)) {
        return fail("invalid-intent-kind", `${key}: ${JSON.stringify(intentKindText)} is not valid type-id text`);
      }
      const commandKindText = declaration.commandKindByIntent[intentKindText];
      if (typeof commandKindText !== "string" || commandKindText.length === 0) {
        return fail("intent-without-command-kind", `${key}: intent ${intentKindText} has no command kind`);
      }
      kinds.push(asIntentKind(intentKindText));
      intentCommandKinds[intentKindText] = commandKindText;
    }
    capabilityIntentKinds[key] = kinds;
  }
  return { ok: true, policy: { capabilityIntentKinds, intentCommandKinds, restrictions } };
}

/** Command kind (branded) for an intent kind, or undefined when unmapped. */
export function commandKindForIntent(policy: BrokerPolicy, intentKind: IntentKind): CommandKind | undefined {
  const text = policy.intentCommandKinds[String(intentKind)];
  return text === undefined ? undefined : asCommandKind(text);
}

function checkIntentKind(
  intentKindText: string,
  declaration: CapabilityCoverageDeclaration,
  handled: ReadonlySet<string>,
  intentCommandKinds: Readonly<Record<string, string>>,
): { code: PolicyErrorCode; detail: string } | undefined {
  if (!isValidTypeIdText(intentKindText)) {
    return { code: "invalid-intent-kind", detail: `${JSON.stringify(intentKindText)} is not valid type-id text` };
  }
  const commandKindText = declaration.commandKindByIntent[intentKindText];
  if (typeof commandKindText !== "string" || commandKindText.length === 0) {
    return { code: "intent-without-command-kind", detail: `intent ${intentKindText} has no command kind` };
  }
  if (!handled.has(intentKindText)) {
    return {
      code: "intent-not-handled-by-rules",
      detail: `intent ${intentKindText} is not handled by any rule node of the document`,
    };
  }
  if (intentCommandKinds[intentKindText] !== undefined && intentCommandKinds[intentKindText] !== commandKindText) {
    return {
      code: "intent-without-command-kind",
      detail: `intent ${intentKindText} maps to conflicting command kinds`,
    };
  }
  return undefined;
}

function collectHandledIntentKinds(document: GameIRDocument): ReadonlySet<string> {
  const handled = new Set<string>();
  for (const node of document.nodes) {
    if ((node as RuleNode).kind === "rule") {
      for (const intentType of (node as RuleNode).handles) {
        handled.add(String(intentType));
      }
    }
  }
  return handled;
}

function deriveRestrictions(document: GameIRDocument): BrokerRestrictions {
  const denied = new Set<string>();
  const approvalRequired = new Set<string>();
  for (const node of document.nodes) {
    if ((node as AvatarBindingNode).kind !== "avatar-binding") {
      continue;
    }
    for (const capability of (node as AvatarBindingNode).restrictions.denied) {
      denied.add(String(avatarCapabilityId(capability)));
    }
    for (const capability of (node as AvatarBindingNode).restrictions.approvalRequired) {
      approvalRequired.add(String(avatarCapabilityId(capability)));
    }
  }
  return {
    denied: [...denied].map((id) => asCapabilityId(id)),
    approvalRequired: [...approvalRequired].map((id) => asCapabilityId(id)),
  };
}

function fail(code: PolicyErrorCode, detail: string): PolicyDerivationResult {
  return { ok: false, code, detail };
}
