/**
 * STATE DOCUMENT (PL-041, E6/E10) — whole-state snapshot serialization
 * and tamper-evident adoption.
 *
 * Snapshots are content-addressed (the digest of the document's canonical
 * JSON — E9) and immutable (a rewrite of the same id with different
 * content is refused by the store port's contract). Restoring adopts the
 * WHOLE document — there is no partial apply — and re-validates it
 * structurally plus the binding invariants (avatar definition digests
 * recompute; restriction shapes re-verify), so a tampered history never
 * re-enters the authority.
 *
 * Purity: pure conversions + one pure adoption oracle. No IO.
 */

import { definitionDigest } from "@playliquid/avatar-runtime";
import { checkRestriction } from "@playliquid/avatar-runtime";
import { digestOf } from "./digest.ts";
import type { RightsStateDocument, StoredRightsSnapshot } from "./ports.ts";
import { isRightsStateDocument } from "./ports.ts";

/** The result of a whole-document adoption. */
export type AdoptionResult =
  | { readonly ok: true; readonly state: RightsStateDocument }
  | { readonly ok: false; readonly code: "malformed-document"; readonly detail: string };

/** Serializes the state into its document form (pure). */
export function documentOf(state: Omit<RightsStateDocument, "documentKind">): RightsStateDocument {
  return { documentKind: "rights-state", ...state };
}

/** The content-addressed identity of a document (E9). */
export function documentDigestOf(document: RightsStateDocument): string {
  return digestOf(document);
}

/** Builds one stored snapshot record (pure). */
export function snapshotOf(state: RightsStateDocument): StoredRightsSnapshot {
  return { snapshotId: documentDigestOf(state), revision: state.revision, document: state };
}

/**
 * Adopts a stored document as the next authority state (fail-closed):
 * structural guard first, then the binding invariants (definition
 * digest recompute + restriction re-verification through avatar-runtime's
 * own oracles — imported, never re-implemented).
 */
export function adoptDocument(document: unknown): AdoptionResult {
  if (!isRightsStateDocument(document)) {
    return { ok: false, code: "malformed-document", detail: "document is not a rights-state document" };
  }
  for (const binding of document.bindings) {
    const recomputed = definitionDigest(binding.definition);
    if (String(recomputed) !== String(binding.definition.definitionDigest)) {
      return {
        ok: false,
        code: "malformed-document",
        detail: `binding ${binding.host} carries a tampered avatar definition digest`,
      };
    }
    if (checkRestriction(binding.restriction) !== undefined) {
      return {
        ok: false,
        code: "malformed-document",
        detail: `binding ${binding.host} carries an invalid host restriction`,
      };
    }
  }
  return { ok: true, state: document };
}
