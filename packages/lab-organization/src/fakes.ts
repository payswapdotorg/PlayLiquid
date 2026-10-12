/**
 * DETERMINISTIC IN-MEMORY FAKES for the Lab organization ports (PL-029).
 *
 * STATUS: TEST SUPPORT ONLY (lock rule 44: no hidden mocks presented as
 * production). Everything here is deterministic and in-memory: no IO, no
 * timers, no randomness, no wall clock. Real body catalogs (the package
 * graph), Tool Fabric resolution, the PL-028 evaluation engine wiring and
 * durable persistence are host concerns — the ports (ports.ts) are the
 * seam. The evaluation port is wired to the REAL lab-simulation engine
 * (PL-028 LabSimulationService over its own in-memory fakes), so tests
 * and the harness exercise the true evaluation path.
 *
 * GRAFT DECISION (the seams.ts TODO): lab-contracts' opaque AgentBodyRef
 * binds to avatar-runtime at THIS package. The binding is mechanical and
 * digest-pinned: `ref.bodyId` identifies the avatar definition and
 * `ref.revisionDigest` pins the avatar-runtime WHOLE-DEFINITION digest
 * (`AvatarDefinition.definitionDigest`) — the catalog resolves a ref only
 * when both match. No second body authority exists here.
 */

import type { AgentBodyRef, AgentToolRef, ZCodeModelAssignmentRef } from "@playliquid/lab-contracts";
import {
  asAgentBodyId,
  asAgentToolId,
  asContentDigest,
  asZCodeModelRouteId,
} from "@playliquid/lab-contracts";
import type { AvatarDefinition, ComposeAvatarInput } from "@playliquid/avatar-runtime";
import { composeAvatar, demoAvatarInput } from "@playliquid/avatar-runtime";
import type { AvatarId } from "@playliquid/game-contracts";
import { asAvatarId } from "@playliquid/game-contracts";
import { LabSimulationService } from "@playliquid/lab-simulation";
import type { LabSimulationPorts } from "@playliquid/lab-simulation";
import { createLabSimulationFakes, labFixtureSuite } from "@playliquid/lab-simulation";
import type { BodyCatalogPort, ToolCatalogPort } from "./compile.ts";
import type { LabOrganizationClockPort, LabOrganizationDocument, LabOrganizationPorts, LabOrganizationStore } from "./ports.ts";

/** A fully caller-programmed clock (the no-wall-clock fake). */
export function createFixedClock(startAt = 1_000): {
  readonly clock: LabOrganizationClockPort;
  readonly advance: (ms: number) => void;
  readonly now: () => number;
} {
  let cursor = startAt;
  return {
    clock: { now: () => cursor },
    advance: (ms) => {
      cursor += ms;
    },
    now: () => cursor,
  };
}

/** The digest-pinned Agent Body reference of one avatar definition (graft). */
export function fixtureBodyRef(definition: AvatarDefinition): AgentBodyRef {
  return {
    bodyId: asAgentBodyId(String(definition.avatarId))!,
    revisionDigest: asContentDigest(String(definition.definitionDigest))!,
  };
}

/** The demo avatar definition (avatar-runtime fixture, composed here). */
export function demoBodyDefinition(): AvatarDefinition {
  return composedOrThrow(demoAvatarInput());
}

/** A second fixture body: touch sensor, manipulation + gaze actuators. */
export function craftBodyDefinition(): AvatarDefinition {
  const input = demoAvatarInput();
  const composed: ComposeAvatarInput = {
    ...input,
    avatarId: CRAFT_BODY_ID,
    sensors: {
      ...input.sensors,
      channels: [{ capability: "touch", channel: "touch.main" }],
    },
    actuators: {
      ...input.actuators,
      actuators: [
        { capability: "manipulation", serves: input.actuators.actuators[0]!.serves },
        { capability: "gaze", serves: input.actuators.actuators[1]!.serves },
      ],
    },
  };
  return composedOrThrow(composed);
}

/** The craft fixture body's avatar id. */
const CRAFT_BODY_ID: AvatarId = asAvatarId("craft-body-1")!;

/** Composes or throws (a fixture that fails composition is a test bug). */
function composedOrThrow(input: ComposeAvatarInput): AvatarDefinition {
  const result = composeAvatar(input);
  if (!result.ok) throw new Error(`lab-organization: fixture body failed composition: ${result.detail}`);
  return result.definition;
}

/** An in-memory digest-pinned body catalog implementing the port. */
export function createBodyCatalog(definitions: readonly AvatarDefinition[] = []): {
  readonly port: BodyCatalogPort;
  readonly add: (definition: AvatarDefinition) => void;
  readonly list: () => readonly AvatarDefinition[];
} {
  const table = new Map<string, AvatarDefinition>();
  for (const definition of definitions) table.set(String(definition.avatarId), definition);
  return {
    port: (ref) => {
      const definition = table.get(String(ref.bodyId));
      return definition !== undefined && String(definition.definitionDigest) === String(ref.revisionDigest)
        ? definition
        : undefined;
    },
    add: (definition) => {
      table.set(String(definition.avatarId), definition);
    },
    list: () => [...table.values()],
  };
}

/** An in-memory digest-pinned Tool Fabric catalog (opaque resolution). */
export function createToolCatalog(refs: readonly AgentToolRef[] = []): {
  readonly port: ToolCatalogPort;
  readonly add: (ref: AgentToolRef) => void;
  readonly list: () => readonly AgentToolRef[];
} {
  const table = new Map<string, AgentToolRef>();
  for (const ref of refs) table.set(String(ref.toolId), ref);
  return {
    port: (ref) => {
      const known = table.get(String(ref.toolId));
      return known !== undefined && String(known.revisionDigest) === String(ref.revisionDigest) ? known : undefined;
    },
    add: (ref) => {
      table.set(String(ref.toolId), ref);
    },
    list: () => [...table.values()],
  };
}

/** Deterministic 64-hex fixture digest derived from text (house pattern). */
export function fixtureDigest(text: string): string {
  let out = "";
  for (let index = 0; index < 64; index += 1) {
    const code = text.charCodeAt(index % text.length) + index * 31;
    out += "0123456789abcdef"[code % 16];
  }
  return out;
}

/** A fixture Tool Fabric tool ref (opaque; digest derived from the id). */
export function fixtureToolRef(toolId: string, variant = 1): AgentToolRef {
  return { toolId: asAgentToolId(toolId)!, revisionDigest: asContentDigest(fixtureDigest(`tool:${toolId}:${variant}`))! };
}

/** A fixture ZCode model assignment (opaque seam ref, lock rule 5). */
export function fixtureModelAssignment(route = "route-lab-org-1"): ZCodeModelAssignmentRef {
  return { authority: "zcode-model-routing", route: asZCodeModelRouteId(route)! };
}

/** An in-memory content-addressed service-document store (E6 fake). */
export function createLabOrganizationStore(): {
  readonly store: LabOrganizationStore;
  readonly documents: () => readonly LabOrganizationDocument[];
} {
  const byDigest = new Map<string, LabOrganizationDocument>();
  return {
    store: {
      save: (document) => {
        // Content-addressed idempotency: the digest IS the content address,
        // so a same-digest save is a no-op (identical state re-snapshot —
        // e.g. a replay receipt that mutated nothing). Different content
        // under one digest is a sha256 collision — out of scope for a fake.
        byDigest.set(document.stateDigest, document);
      },
      load: () => [...byDigest.values()].slice(-1)[0],
    },
    documents: () => [...byDigest.values()],
  };
}

/** Wires the full fake port bundle with the REAL PL-028 evaluation engine. */
export function createLabOrganizationFakes(options?: {
  readonly bodies?: readonly AvatarDefinition[];
}): {
  readonly ports: LabOrganizationPorts;
  readonly clock: ReturnType<typeof createFixedClock>;
  readonly bodies: ReturnType<typeof createBodyCatalog>;
  readonly tools: ReturnType<typeof createToolCatalog>;
  readonly store: ReturnType<typeof createLabOrganizationStore>;
  readonly simulation: {
    readonly service: LabSimulationService;
    readonly ports: LabSimulationPorts;
  };
} {
  const clock = createFixedClock();
  const bodies = createBodyCatalog(options?.bodies ?? [demoBodyDefinition(), craftBodyDefinition()]);
  const tools = createToolCatalog([fixtureToolRef("tool-fabric-editor"), fixtureToolRef("tool-fabric-cli")]);
  const store = createLabOrganizationStore();
  const simulationFakes = createLabSimulationFakes({ suites: [labFixtureSuite()] });
  const simulation = new LabSimulationService({ ports: simulationFakes.ports });
  return {
    ports: {
      clock: clock.clock,
      bodies: bodies.port,
      tools: tools.port,
      evaluation: simulation,
      store: store.store,
    },
    clock,
    bodies,
    tools,
    store,
    simulation: { service: simulation, ports: simulationFakes.ports },
  };
}
