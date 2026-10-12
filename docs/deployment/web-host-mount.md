# The web host mount recipe (services/ops, PL-033/034)

`services/ops/src/web-host.ts` realizes the PL-033/034 web mount
contract as ONE typed host document: the HOST WIRING MODEL a web host
instantiates. The deployment plan's `unit-web-host` deploys exactly this
composition.

## The recipe (how a host mounts a workbench)

A host mounts each workbench by:

1. **providing the workbench's documented port seams** — the data port
   (and the command port where the workbench has one) — from a demo
   fixture or a host adapter;
2. **creating the workbench's ONE UI-state owner** — its store factory;
3. **rendering the shell** — step (3) is the browser host's concern and
   is recorded here as `rendered: false` truth, never simulated.

The frozen vocabulary mirrors the documented public contracts of
game-ui (StudioApp), gameos-lab and gameos-community:

| Workbench | Required port seams | One-store factory |
| --- | --- | --- |
| `game-studio` | `StudioDataPort` | `createStudioStore` |
| `gameos-lab` | `LabDataPort`, `LabCommandPort` | `createLabStore` |
| `gameos-community` | `CommunityDataPort`, `CommunityCommandPort` | `createCommunityStore` |

A port seam is provided either by a **demo fixture**
(`demoStudioSnapshot` / `demoLabSnapshot` / `demoCommunitySnapshot`) or by
a **host adapter** (a named host-side implementation).

## The honest topology's host document

```ts
composeWebHost([
  {
    mountId: "mount-game-studio",
    workbench: "game-studio",
    ports: [{ port: "StudioDataPort", provider: { source: "demo-fixture", fixture: "demoStudioSnapshot" } }],
    rendered: false,
  },
  {
    mountId: "mount-gameos-lab",
    ports: [
      { port: "LabDataPort", provider: { source: "demo-fixture", fixture: "demoLabSnapshot" } },
      { port: "LabCommandPort", provider: { source: "host-adapter", adapter: "ops-lab-command-adapter" } },
    ],
    workbench: "gameos-lab",
    rendered: false,
  },
  {
    mountId: "mount-gameos-community",
    ports: [
      { port: "CommunityDataPort", provider: { source: "demo-fixture", fixture: "demoCommunitySnapshot" } },
      { port: "CommunityCommandPort", provider: { source: "host-adapter", adapter: "ops-community-command-adapter" } },
    ],
    workbench: "gameos-community",
    rendered: false,
  },
]);
```

The composed document is content-addressed (`hostDigest` over the
mounts) and verifies structurally: known workbenches, every required
seam bound exactly once, known fixtures, unique mount ids — and the
environment truth (`dom: false`, `rendering: false`, `network: false`)
both on the document and on every mount. A document that claims DOM,
rendering or network cannot verify (`honesty-violation`); a tampered
document no longer matches its content address (`tampered-document`).

## What the tests prove (13 tests, E8/E9/E11)

- the three workbenches of the honest topology mount and verify;
- the composition is deterministic — the same mounts compose to the
  same content address, twice (E9);
- the vocabulary mirrors the documented seams/store factories;
- every malformed composition is a typed refusal: empty mounts, unknown
  workbench, missing/unknown/duplicated port bindings, duplicate mount
  ids, unknown fixture;
- honesty refusals: a mount claiming rendering, a document claiming
  DOM/network (E11);
- a tampered host document refuses (`tampered-document`).

## Honest limits (E11)

This composition is DATA + TYPED WIRING ONLY. There is no DOM, no
rendering, no browser process and no network anywhere in this tree —
the executable proof that the REAL stores, ports and view models work
end-to-end lives in the **qa/browser journey suite** (PL-043: the
studio, lab, community and native journeys over the real packages). A
vite host instantiating this wiring model would provide the port seams
from its own adapters (or the demo fixtures), call the one store
factory per workbench, and render the shell — the document is the
recipe, the journeys are the evidence, and neither fakes the browser.
