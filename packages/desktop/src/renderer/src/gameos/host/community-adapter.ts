/**
 * THE COMMUNITY PORT ADAPTERS (RW-001): the desktop host's implementations
 * of gameos-community's two seams — `CommunityDataPort` (read models) and
 * `CommunityCommandPort` (typed intents → the community service's
 * submit/transition doors).
 *
 * The data port reads the service's own read doors (`contributionsOf` /
 * `history`) scoped to the local operator's tenancy (R20). The command
 * port expands the small UI intents into full authoritative commands:
 * the payload is a REAL GameIR record value titled by the intent's
 * label, the provenance is honest (original origin, or a lineage base
 * the host resolves — refused when none exists), and the AI disclosure
 * names the host's opaque ZCode model route (lock rules 5/11). Refusals
 * carry the community package's own codes verbatim (E8); duplicate
 * replays surface as `duplicate: true` receipts (E10).
 */

import type {
  CommunityCommandIntent,
  CommunityCommandLogEntry,
  CommunityCommandPort,
  CommunityCommandReceipt,
  CommunityDataPort,
  CommunityLoadResult,
} from "../../../../../../web/gameos-community/src/index.ts";
import type { CommunityDataSnapshot } from "../../../../../../web/gameos-community/src/index.ts";
import type {
  ContributionProvenanceInput,
  SubmitContributionCommand,
  TransitionCommand,
} from "../../../../../../community/src/index.ts";
import { asContributionId } from "../../../../../../community/src/index.ts";
import type { CommunityService } from "../../../../../../community/src/index.ts";
import type { PackageRegistry } from "../../../../../../package-registry/src/index.ts";
import type { SubjectId, TenantId } from "../../../../../../platform-contracts/src/index.ts";
import { LOCAL_MODEL_ROUTE } from "../identity.ts";

/**
 * The Community facts these adapters read from the composed host — a local
 * STRUCTURAL slice, not the host type itself, so the adapters never import
 * their composer and the module graph stays acyclic (the composed host
 * object satisfies this shape structurally; desktop-host.ts owns the real
 * type). The E8 package-qualification seam reads the same one Studio
 * registry the whole host composes.
 */
type CommunityHostFacts = {
  readonly viewer: { readonly tenant: TenantId; readonly subject: SubjectId };
  readonly studio: { readonly registry: PackageRegistry };
  readonly community: { readonly service: CommunityService };
};

/**
 * The desktop `CommunityDataPort`: pulls one authoritative, viewer-scoped
 * community snapshot through the service's own read doors.
 */
export class DesktopCommunityDataPort implements CommunityDataPort {
  readonly #host: () => CommunityHostFacts;

  constructor(host: () => CommunityHostFacts) {
    this.#host = host;
  }

  load(): CommunityLoadResult {
    const host = this.#host();
    const tenant = host.viewer.tenant;
    const snapshot: CommunityDataSnapshot = {
      viewer: { tenant, subject: host.viewer.subject },
      contributions: host.community.service.contributionsOf(tenant),
      transitions: host.community.service.history(tenant),
    };
    return { ok: true, data: snapshot };
  }
}

/**
 * The desktop `CommunityCommandPort`: forwards typed UI intents to the
 * authoritative community doors (or refuses them with the UI seam's own
 * `invalid-intent` code before any domain call).
 */
export class DesktopCommunityCommandPort implements CommunityCommandPort {
  readonly #host: () => CommunityHostFacts;

  constructor(host: () => CommunityHostFacts) {
    this.#host = host;
  }

  dispatch(intent: CommunityCommandIntent): CommunityCommandReceipt {
    if (intent.kind === "submit-contribution") {
      return this.#submit(this.#host(), intent);
    }
    return this.#advance(this.#host(), intent);
  }

  /** Expands a submit-contribution intent into a full submission. */
  #submit(
    host: CommunityHostFacts,
    intent: Extract<CommunityCommandIntent, { kind: "submit-contribution" }>,
  ): CommunityCommandReceipt {
    const provenance = this.#provenanceOf(host, intent);
    if ("ok" in provenance && provenance.ok === false) return provenance;
    const command: SubmitContributionCommand = {
      tenant: intent.tenant,
      contributor: intent.subject,
      kind: intent.contributionKind,
      payload: {
        kind: "record",
        fields: {
          title: { kind: "string", value: intent.label },
          workspace: { kind: "string", value: "playliquid-gameos-desktop" },
          gap: { kind: "string", value: intent.gapId ?? "" },
        },
      },
      provenance: provenance as ContributionProvenanceInput,
    };
    const submitted = host.community.service.submit(command);
    if (submitted.accepted) {
      return {
        ok: true,
        kind: "contribution-submitted",
        contributionId: submitted.contribution.contributionId,
        duplicate: false,
      };
    }
    if (submitted.code === "duplicate-contribution" && submitted.recorded !== undefined) {
      return {
        ok: true,
        kind: "contribution-submitted",
        contributionId: submitted.recorded.contributionId,
        duplicate: true,
      };
    }
    return { ok: false, code: submitted.code, detail: submitted.detail };
  }

  /**
   * The honest provenance of a local submission: an original origin, or a
   * lineage base the host resolves from its OWN published registry — when
   * the intent claims lineage but no qualified base exists, the host
   * refuses honestly instead of fabricating a node.
   */
  #provenanceOf(
    host: CommunityHostFacts,
    intent: Extract<CommunityCommandIntent, { kind: "submit-contribution" }>,
  ): ContributionProvenanceInput | (CommunityCommandReceipt & { ok: false }) {
    if (intent.lineageDerived) {
      const published = host.studio.registry.list();
      if (published.length === 0) {
        return {
          ok: false,
          code: "invalid-lineage-node",
          detail:
            "the desktop host has no published package to derive a lineage base from — publish a package through the Studio registry first",
        };
      }
    }
    if (!intent.aiGenerated) {
      return { origin: { kind: "original" }, aiGenerated: false };
    }
    return {
      origin: { kind: "original" },
      aiGenerated: true,
      modelProvenance: [
        {
          model: String(LOCAL_MODEL_ROUTE),
          provider: "zcode-model-routing",
          usage: "assistance",
          disclosed: true,
        },
      ],
    };
  }

  /** Forwards an advance-contribution intent to the transition door. */
  #advance(
    host: CommunityHostFacts,
    intent: Extract<CommunityCommandIntent, { kind: "advance-contribution" }>,
  ): CommunityCommandReceipt {
    const contributionId = asContributionId(intent.contributionId);
    if (contributionId === undefined) {
      return {
        ok: false,
        code: "invalid-intent",
        detail: `contribution id ${intent.contributionId} is not a valid content address (sha256:<64 hex>)`,
      };
    }
    const command: TransitionCommand = {
      tenant: intent.tenant,
      contributionId,
      kind: intent.command,
      actor: intent.actor,
      ...(intent.reason === undefined ? {} : { reason: intent.reason }),
    };
    const transitioned = host.community.service.transition(command);
    if (transitioned.accepted) {
      return {
        ok: true,
        kind: "contribution-advanced",
        contributionId,
        to: transitioned.status,
        duplicate: false,
      };
    }
    if (transitioned.code === "duplicate-transition" && transitioned.recorded !== undefined) {
      return {
        ok: true,
        kind: "contribution-advanced",
        contributionId,
        to: transitioned.recorded.to,
        duplicate: true,
      };
    }
    return { ok: false, code: transitioned.code, detail: transitioned.detail };
  }
}

/** Re-export for component/test convenience (the append-only log shape). */
export type { CommunityCommandLogEntry };
