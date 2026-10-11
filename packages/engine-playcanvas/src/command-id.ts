/**
 * Module role: content-derived command ids (E9) — deterministic command
 * keys derived from the command inputs (capability + validated payload +
 * deadline), so identical inputs map to identical ids and duplicate
 * detection is content-based, not sequence-based. No randomness, no
 * wall-clock. The digest machinery is the sibling-precedent canonical
 * JSON + sha256 pair (digest.ts).
 *
 * Implements: PL-021 determinism discipline (E9: command ids are
 * content/inputs-derived where feasible).
 */

import { contentDigestOf } from "./digest.ts";
import type { PlayCanvasCommandPayload } from "./payload-model.ts";

/** Digest prefix (namespace) for adapter-derived command identities. */
export const PLAYCANVAS_COMMAND_ID_PREFIX = "playcanvas-cmd" as const;

/**
 * Deterministic command key for a validated payload + capability. Stable
 * across processes and stations: canonical JSON → sha256, truncated to
 * 32 hex chars for id readability while keeping collision discipline.
 */
export function playCanvasCommandKey(capability: string, payload: PlayCanvasCommandPayload, deadlineAtEpochMs?: number): string {
  const digest = contentDigestOf({
    capability,
    payload,
    ...(deadlineAtEpochMs === undefined ? {} : { deadlineAtEpochMs }),
  });
  return `${PLAYCANVAS_COMMAND_ID_PREFIX}-${digest.slice(0, 32)}`;
}

/**
 * Deterministic command id for the neutral exchange (fits the contract's
 * 128-char commandId limit): caller id + content key.
 */
export function playCanvasCommandId(callerKey: string, commandKey: PlayCanvasCommandKeyAlias): string {
  return `${callerKey}:${commandKey}`;
}

type PlayCanvasCommandKeyAlias = string;
