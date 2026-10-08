/**
 * SESSION SNAPSHOTS — the owner of snapshot boundary state.
 *
 * Owns (E1):
 * - the snapshot boundary registry (`SessionSnapshot[]` read model used by
 *   replay/resume boundary validation);
 * - access to the host-side content-addressed store port.
 *
 * The kernel supplies current-state accessors as closures. Byte-stability
 * (E9) is the joint property of the canonical serializer (serialize.ts —
 * kernel-owned byte layout) and the store's digest (host-owned hashing).
 * Global sequences NEVER rewind on restore (log immutability, E10); the
 * payload's counters are provenance metadata.
 */

import type {
  DeterminismSeed,
  SessionEpoch,
  SessionId,
  SessionSnapshot,
  SnapshotId,
  Tick,
} from "@playliquid/runtime-contracts";
import { asEventSequence } from "@playliquid/runtime-contracts";
import type { SnapshotStorePort } from "./ports.ts";
import {
  SNAPSHOT_FORMAT,
  SnapshotDecodeError,
  decodeSnapshotPayload,
  encodeSnapshotBytes,
  type JsonSafeValue,
  type KernelSnapshotPayload,
} from "./serialize.ts";
import type { KernelRejection } from "./results.ts";

/** Kernel surface the snapshot owner may use (closure-supplied). */
export interface SnapshotHost<W> {
  readonly sessionId: SessionId;
  readonly worldKind: string;
  readonly store: SnapshotStorePort;
  epoch(): SessionEpoch;
  tick(): Tick;
  world(): W;
  committedEventSeq(): number;
  admittedCommandSeq(): number;
  determinism(): DeterminismSeed | undefined;
}

/** Restore plan: decoded + validated payload awaiting kernel commit. */
export type RestorePlan =
  | { readonly status: "plan"; readonly payload: KernelSnapshotPayload }
  | { readonly status: "rejected"; readonly code: KernelRejection["code"]; readonly detail: string };

/**
 * The snapshot boundary owner. `snapshot()` builds the canonical payload,
 * hands it (plus its canonical bytes) to the store, and records the
 * returned content-addressed boundary. `restore()` loads + validates a
 * payload and returns it as a plan; the KERNEL commits the state.
 */
export class SessionSnapshots<W extends JsonSafeValue> {
  readonly #host: SnapshotHost<W>;
  readonly #boundaries: SessionSnapshot[] = [];

  constructor(host: SnapshotHost<W>) {
    this.#host = host;
  }

  get boundaries(): readonly SessionSnapshot[] {
    return this.#boundaries;
  }

  snapshot():
    | { readonly status: "snapshotted"; readonly epoch: SessionEpoch; readonly snapshot: SessionSnapshot }
    | { readonly status: "failed"; readonly epoch: SessionEpoch; readonly code: "driver-failure"; readonly detail: string } {
    const determinism = this.#host.determinism();
    const payload: KernelSnapshotPayload = {
      format: SNAPSHOT_FORMAT,
      sessionId: this.#host.sessionId,
      epoch: this.#host.epoch(),
      tick: this.#host.tick(),
      committedEventSeq: this.#host.committedEventSeq(),
      admittedCommandSeq: this.#host.admittedCommandSeq(),
      worldKind: this.#host.worldKind,
      world: this.#host.world(),
      ...(determinism !== undefined ? { determinism } : {}),
    };
    let bytes: string;
    try {
      bytes = encodeSnapshotBytes(payload);
    } catch (error) {
      return {
        status: "failed",
        epoch: this.#host.epoch(),
        code: "driver-failure",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    const stored = this.#host.store.save(payload, bytes);
    const boundary: SessionSnapshot = {
      snapshotId: stored.snapshotId,
      sessionId: this.#host.sessionId,
      epoch: this.#host.epoch(),
      tick: this.#host.tick(),
      afterEventSeq: asEventSequence(this.#host.committedEventSeq()),
      stateDigest: stored.stateDigest,
    };
    this.#boundaries.push(boundary);
    return { status: "snapshotted", epoch: this.#host.epoch(), snapshot: boundary };
  }

  restore(snapshotId: SnapshotId): RestorePlan {
    const raw = this.#host.store.load(snapshotId);
    if (raw === undefined) {
      return {
        status: "rejected",
        code: "unknown-snapshot",
        detail: `no snapshot ${String(snapshotId)} in the store`,
      };
    }
    try {
      const payload = decodeSnapshotPayload(raw, {
        sessionId: this.#host.sessionId,
        worldKind: this.#host.worldKind,
      });
      return { status: "plan", payload };
    } catch (error) {
      if (error instanceof SnapshotDecodeError) {
        const code =
          error.code === "session-mismatch"
            ? "snapshot-wrong-session"
            : error.code === "world-kind-mismatch"
              ? "snapshot-world-kind-mismatch"
              : "unknown-snapshot";
        return { status: "rejected", code, detail: `restore refused: ${error.message}` };
      }
      return {
        status: "rejected",
        code: "unknown-snapshot",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
