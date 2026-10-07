/**
 * ARENA TRANSPORT PORT — provider-neutral by construction (E3: provider
 * SDKs do not leak into domain contracts; lock rule 21 for the Arena
 * analogue).
 *
 * The external Arena endpoint, transport and wire protocol are BEHIND this
 * port. Real implementations (arena runtime, PL-031) bind concrete
 * transports; this package ships only the typed port and a deterministic
 * in-memory fake for tests. There is NO provider vocabulary anywhere in
 * the port or its error vocabulary — the endpoint identity is an opaque
 * digest-pinned {@link ArenaEndpointRef}, and any provider name appearing
 * in these authority types is a negative-tested violation
 * (`provider-neutrality.test.ts`).
 *
 * The port is async by nature (a real exchange crosses a wire) but
 * carries no other ambient authority: no clock, no retries with jitter,
 * no connection state. Retry/replacement policy belongs to the caller.
 *
 * Purity of this package: the fake performs no IO — it answers from a
 * caller-supplied pure responder function.
 */

import { frozenVocabulary } from "./primitives.ts";
import { isArenaRequestEnvelope } from "./request.ts";
import type { ArenaRequestEnvelope } from "./request.ts";
import type { ArenaEndpointRef } from "./primitives.ts";
import type { ArenaResponseEnvelope } from "./response.ts";

// ---------------------------------------------------------------------------
// Transport error vocabulary (frozen, provider-neutral)
// ---------------------------------------------------------------------------

/**
 * The frozen vocabulary of transport-level failures. Deliberately free of
 * provider terms: HTTP/gRPC/vendor statuses are the implementing
 * adapter's vocabulary, never this port's.
 */
export type ArenaTransportErrorKind = "arena-unreachable" | "arena-timeout" | "arena-protocol-violation";

/** All valid {@link ArenaTransportErrorKind} values. */
export const ARENA_TRANSPORT_ERROR_KINDS = frozenVocabulary<ArenaTransportErrorKind>("arena-transport-error-kind", [
  "arena-unreachable",
  "arena-timeout",
  "arena-protocol-violation",
]);

/** Returns true when `value` is a valid {@link ArenaTransportErrorKind}. */
export function isArenaTransportErrorKind(value: unknown): value is ArenaTransportErrorKind {
  return ARENA_TRANSPORT_ERROR_KINDS.is(value);
}

/** One transport-level failure, pinned to the endpoint it concerns. No free-form detail: machine-checkable or nothing. */
export type ArenaTransportError = Readonly<{
  errorKind: ArenaTransportErrorKind;
  endpoint: ArenaEndpointRef;
}>;

/** The outcome of one send through an {@link ArenaTransport}. */
export type ArenaTransportResult =
  | { readonly ok: true; readonly response: ArenaResponseEnvelope }
  | { readonly ok: false; readonly error: ArenaTransportError };

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/** Structural kind marker of the {@link ArenaTransport} port. */
export type ArenaTransportPortKind = "arena-transport";

/** Marker value for {@link ArenaTransportPortKind}. */
export const ARENA_TRANSPORT_PORT_KIND: ArenaTransportPortKind = "arena-transport";

/**
 * The pure transport port: sends one provider-neutral wire request
 * envelope to the external Arena named by `envelope.endpoint` and resolves
 * with a typed response envelope or a typed transport error.
 *
 * Implementations MUST:
 * - keep provider vocabulary behind the port (E3);
 * - stay keyed to digest-pinned endpoint identity only;
 * - surface application-level Arena refusals as RESPONSE envelopes (a
 *   refusal is data for the validator), reserving {@link ArenaTransportError}
 *   for transport-level failures.
 */
export type ArenaTransport = Readonly<{
  portKind: ArenaTransportPortKind;
  send(envelope: ArenaRequestEnvelope): Promise<ArenaTransportResult>;
}>;

// ---------------------------------------------------------------------------
// Deterministic in-memory fake (tests, harness)
// ---------------------------------------------------------------------------

/**
 * A pure responder: folds one request envelope into a response envelope or
 * a transport error. Deterministic by contract — same input, same output.
 */
export type ArenaResponder = (envelope: ArenaRequestEnvelope) => ArenaTransportResult;

/**
 * Builds a deterministic in-memory fake transport serving exactly ONE
 * digest-pinned endpoint. Requests aimed at any other endpoint are
 * refused with `arena-protocol-violation` (the fake is not bound to
 * them). Every accepted envelope is recorded (exposed through
 * `sentEnvelopes()`) so tests can assert exactly what crossed the port.
 *
 * The fake performs no IO: it answers synchronously from `respond` inside
 * a resolved promise.
 */
export function inMemoryArenaTransport(options: {
  endpoint: ArenaEndpointRef;
  respond: ArenaResponder;
}): ArenaTransport & { sentEnvelopes(): readonly ArenaRequestEnvelope[] } {
  const sent: ArenaRequestEnvelope[] = [];
  return {
    portKind: ARENA_TRANSPORT_PORT_KIND,
    async send(envelope: ArenaRequestEnvelope): Promise<ArenaTransportResult> {
      if (!isArenaRequestEnvelope(envelope)) {
        return { ok: false, error: { errorKind: "arena-protocol-violation", endpoint: options.endpoint } };
      }
      if (envelope.endpoint.endpointDigest !== options.endpoint.endpointDigest) {
        return { ok: false, error: { errorKind: "arena-protocol-violation", endpoint: envelope.endpoint } };
      }
      sent.push(envelope);
      return options.respond(envelope);
    },
    sentEnvelopes(): readonly ArenaRequestEnvelope[] {
      return Object.freeze([...sent]);
    },
  };
}
