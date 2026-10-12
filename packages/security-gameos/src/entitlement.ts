/**
 * SETTLEMENT-ACTION AUTHORIZATION (PL-041 composing PL-017, R10) — the
 * pure gate that decides whether an economy settlement ACTION is a
 * right, over TYPED READ-ONLY economy input.
 *
 * The economy service stays the settlement owner (PL-017): this module
 * never mutates economy state, never re-implements its oracles, and
 * surfaces its frozen codes verbatim:
 * - the acting subject must hold the platform `rewards` capability with
 *   the action's permission (settle: `submit`; lifecycle:
 *   `administer`) via platform-contracts' own `checkLeastPrivilege`
 *   oracle — codes VERBATIM;
 * - a settle-event action must be for a game-DECLARED event kind — the
 *   economy's frozen `event-not-declared` code (settlement without
 *   entitlement/declaration never proceeds, lock 18);
 * - an entitlement-lifecycle action must target an entitlement RECORDED
 *   in the tenant (`unknown-entitlement`, the economy door's own code)
 *   and HELD by the acting subject (`entitlement-holder-mismatch` —
 *   spending another subject's entitlement is a typed refusal, R20);
 * - a suspended subject cannot settle or move entitlements at all
 *   (`suspended-by-integrity` — the R10 × R11 composition).
 *
 * Purity: one pure fold over caller-derived facts. No IO.
 */

import { checkLeastPrivilege } from "@playliquid/platform-contracts";
import type { EntitlementGrantId, GameEventKind, ScopedCapabilityGrant } from "@playliquid/platform-contracts";
import type { SettlementEligibilityDeclaration } from "@playliquid/platform-contracts";
import type { EntitlementRead, IntegrityRightsEntry } from "./ports.ts";
import type { SettlementAuthorizationCode } from "./vocabulary.ts";

/** One settlement action an actor asks the rights authority to authorize. */
export type SettlementActionRequest =
  | { readonly kind: "settle-event"; readonly subject: string; readonly eventKind: GameEventKind }
  | { readonly kind: "entitlement-lifecycle"; readonly subject: string; readonly entitlement: EntitlementGrantId };

/** The typed authorization verdict (E8). */
export type SettlementAuthorization =
  | {
      readonly authorized: true;
      readonly tenant: string;
      readonly subject: string;
      readonly action: string;
      readonly basis: readonly string[];
    }
  | {
      readonly authorized: false;
      readonly code: SettlementAuthorizationCode;
      readonly detail: string;
      readonly evidence: readonly string[];
    };

/** Everything the pure gate needs (read-only facts). */
export interface SettlementGateInputs {
  readonly platformGrants: readonly ScopedCapabilityGrant[];
  readonly declarations: readonly SettlementEligibilityDeclaration[];
  readonly entitlement: EntitlementRead | undefined;
  readonly suspension: IntegrityRightsEntry | undefined;
}

/** THE authorization fold (pure). */
export function authorizeSettlementAction(
  actor: string,
  tenant: string,
  request: SettlementActionRequest,
  inputs: SettlementGateInputs,
): SettlementAuthorization {
  const permission = request.kind === "settle-event" ? "submit" : "administer";
  const privilege = checkLeastPrivilege(
    {
      tenant: tenant as ScopedCapabilityGrant["tenant"],
      subject: actor as ScopedCapabilityGrant["subject"],
      capability: "rewards",
      permission,
    },
    inputs.platformGrants,
  );
  if (!privilege.ok) {
    return denied(
      privilege.code,
      `rewards ${permission} least-privilege refusal: ${privilege.code}`,
      [`actor:${actor}`, `permission:${permission}`],
    );
  }
  if (inputs.suspension !== undefined) {
    return denied(
      "suspended-by-integrity",
      `integrity standing ${inputs.suspension.verdictKind} (band ${inputs.suspension.band}) suspends settlement actions`,
      [`verdict:${inputs.suspension.verdictId}`, `subject:${request.subject}`],
    );
  }
  if (request.kind === "settle-event") {
    const declared = inputs.declarations.some(
      (declaration) => String(declaration.eventKind) === String(request.eventKind),
    );
    if (!declared) {
      // platform-economy's own frozen settlement code, surfaced verbatim.
      return denied(
        "event-not-declared",
        `event kind ${String(request.eventKind)} is not a game-declared settlement-eligible event in this tenant`,
        [`event:${String(request.eventKind)}`, `tenant:${tenant}`],
      );
    }
    return {
      authorized: true,
      tenant,
      subject: request.subject,
      action: "settle-event",
      basis: [`event:${String(request.eventKind)}`, `declared-by:${tenant}`, `actor:${actor}:${permission}`],
    };
  }
  const entitlement = inputs.entitlement;
  if (entitlement === undefined) {
    // the economy door's own code for an entitlement not recorded in the
    // tenant — surfaced verbatim (cross-tenant reads are invisible).
    return denied(
      "unknown-entitlement",
      `the entitlement is not recorded in this tenant`,
      [`entitlement:${String(request.entitlement)}`, `tenant:${tenant}`],
    );
  }
  if (String(entitlement.grant.subject) !== request.subject) {
    return denied(
      "entitlement-holder-mismatch",
      `entitlement ${String(entitlement.grant.grantId)} is held by ${String(entitlement.grant.subject)}, not ${request.subject}`,
      [`entitlement:${String(entitlement.grant.grantId)}`, `holder:${String(entitlement.grant.subject)}`],
    );
  }
  return {
    authorized: true,
    tenant,
    subject: request.subject,
    action: "entitlement-lifecycle",
    basis: [
      `entitlement:${String(entitlement.grant.grantId)}`,
      `holder:${request.subject}`,
      `state:${entitlement.lifecycle.state}`,
      `actor:${actor}:${permission}`,
    ],
  };
}

function denied(
  code: SettlementAuthorizationCode,
  detail: string,
  evidence: readonly string[],
): SettlementAuthorization {
  return { authorized: false, code, detail, evidence };
}
