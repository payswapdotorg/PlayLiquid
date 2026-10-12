# examples/engine-integration — the Engine-native reference workflow (PL-038)

The third reference proof after `examples/native-game` (PL-037) and
`examples/large-world` (PL-039): the demonstration that **GameOS-native
projects build for real engines through typed adapters** — assets authored
through the Blender tool adapter, targets adjudicated by the three engine
adapters' typed bindings, staged builds through the real
build-orchestrator, and every sealed artifact resolved through the
registry/CAS with provenance.

## What IS exercised (all through public entrypoints)

- **Real adapter registrations over the real Tool Fabric runtime**
  (PL-019): one rig registers the real `tool.blender` (PL-025),
  `engine.unreal` (PL-022), `engine.unity` (PL-023) and `engine.godot`
  (PL-024) adapters as tools behind the runtime's registry; every tool
  call dispatches through the pipeline (envelope validation, idempotency
  ledger, capability mediation, shape seam, the content-addressed exchange
  guard, adapter-dispatch executor) — never around it (E2).
- **Real engine bindings adjudicating sealed target profile records**:
  `unrealCanServeTargetProfile` / `unityCanServeTargetProfile` /
  `godotCanServeTargetProfile` compose target-profiles' mutual-consent
  compatibility check over the workflow's sealed records; verdicts are
  typed — out-of-set targets and undeclared engines refuse with the
  adapters' verbatim codes (E8).
- **Real staged builds through the real build-orchestrator** (PL-020):
  tenant-scoped intake over build-contracts' admission oracle, the
  E10 phase-arc pipeline (resolve → plan → emit → verify → package →
  succeeded) with the R19 provenance/licensing closure gate, the
  registry build source (locks + known content) and the engine fabric
  port dispatching each operation through the runtime to the real
  `engine.unreal` adapter.
- **Real registry/CAS resolution with locks**: binary content in the
  real artifact store (the CAS, E7) and package records in the real
  package registry over in-memory stores; publication runs the
  registry's transactional admission — structural validation, the R19
  release gate, CAS-artifact verification (fail closed); the lock pins
  exact versions + content digests (lock rule 10) and is verified
  against BOTH authorities.
- **Deterministic journals (E9/E10)**: one append-only, content-chained
  workflow journal per run under an injected clock; duplicate appends
  are idempotent; a tampered snapshot is detected (chain-broken); two
  independent runs produce byte-identical journals, digests, receipts
  and build ids.

## What is NOT exercised (E11 honesty)

- **No real engine binaries.** No Unreal, Unity, Godot or Blender
  editor/tool is installed, invoked or pretended. The adapters run over
  their own shipped **fake bridges** — the packages' deterministic
  in-process test seams behind the pure bridge ports. `build.package`'s
  minted artifact references are therefore not exercised through the
  exchange (the fake bridges never upload bytes; documented in
  `src/builds.ts`).
- **No network, no child processes, no filesystem artifacts** beyond
  the in-memory stores (exchange, CAS, registry, build store). No
  rendering — the workflow is headless evidence, not a view.
- The rig's host wiring (operation → capability binding, shape
  validators) is this example's own E11-labeled seam; everything behind
  it is the packages' real code.

## Run

```bash
cd examples/engine-integration
npx tsc -p .                    # typecheck (exit 0)
node --test "src/**/*.test.ts"  # 15 tests: 7 determinism/walk + 8 E8 negative battery
```

`src/determinism.test.ts` runs the canonical workflow twice and asserts
identical evidence, then walks each stage's real evidence trail.
`src/negative.test.ts` asserts every typed refusal with its code
verbatim (out-of-set targets, the contract precedence, R20 tenancy,
payload validation, the exchange guard, journal integrity, fail-closed
publication, idempotent re-submission).
