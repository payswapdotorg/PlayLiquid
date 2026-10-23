# PlayLiquid GameOS — Journey Map (UX-002)

The feature-to-journey map of the PlayLiquid GameOS desktop product, in the frozen form
`entry point → prerequisites → authoritative operation → result/state → test evidence`.

**How to read this map.** PlayLiquid GameOS is a game engineering operating system with
three product workspaces in the desktop top bar — **Game Studio**, **Lab**, **Community** —
plus the **AI & Agents** escape hatch (models, agents and provider capabilities; the shell
button marker is `gameos-nav-workbench`, label per the frozen UX contract). Every operation
below is **REAL** — wired to its authoritative port today, verifiable in source — or it is
marked **not yet supported** with the missing prerequisite stated. Nothing here is a mock
presented as production (lock rule 44; `packages/desktop/src/renderer/src/gameos/host/desktop-host.ts`
composes the real domain services behind the module port seams and "no demo fixtures, no
fakes").

**Where the truth lives.** The desktop product shell
(`packages/desktop/src/renderer/src/gameos/shell/product-shell.tsx`) mounts the three
workspaces from real hosts behind typed port seams:

| workspace | UI module | authoritative backing systems (host-composed) | ports |
| --- | --- | --- | --- |
| Game Studio | `packages/game-ui/src/**` | package-registry + package-system release gate, capability-broker, tool-fabric-runtime | `StudioDataPort` (read) |
| Lab | `packages/web/gameos-lab/src/**` | lab-organization + lab-simulation + lab-learning (+ Arena read model) | `LabDataPort` (read) + `LabCommandPort` (typed intents) |
| Community | `packages/web/gameos-community/src/**` | community service (Git-style lifecycle, provenance) + the Studio registry (E8 qualification seam) and the Lab gap records (R18 seam) | `CommunityDataPort` (read) + `CommunityCommandPort` (typed intents) |

Source: `packages/desktop/src/renderer/src/gameos/host/desktop-host.ts`,
`packages/desktop/src/renderer/src/gameos/host/studio-adapter.ts`, `packages/desktop/src/renderer/src/gameos/host/lab-adapter.ts`, `packages/desktop/src/renderer/src/gameos/host/community-adapter.ts`.

**First-run truth (the honest starting point).** On a clean first run every workspace
composes real but EMPTY services — the registry is open with zero packages, no runtime
session or avatars are composed, the Lab ledgers start empty, and Arena reads zero cases
(pinned by `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts`: "the host composes the real services and answers empty
first snapshots"). Each of those no-data surfaces now renders the UX-002 first-run empty
state: a container `data-testid="gameos-empty-state"` that explains the surface in plain
product language and offers one REAL next step control
`data-testid="gameos-empty-next-step"` (the module's own refresh pull or typed-intent
dispatch). The copy is a frozen pure view model with its own tests:
`packages/game-ui/src/view/onboarding.ts` (+ `onboarding.test.ts`),
`packages/web/gameos-lab/src/view/onboarding.ts` (+ `onboarding.test.ts`),
`packages/web/gameos-community/src/view/onboarding.ts` (+ `onboarding.test.ts`).

---

## Journey 1 — Start: open a game or project (create/import where actually supported)

| entry point | prerequisites | authoritative operation | result/state | test evidence |
| --- | --- | --- | --- | --- |
| Product top bar → **Game Studio** (`gameos-nav-studio`; the default first-run workspace, `packages/desktop/src/renderer/src/gameos/shell/product-shell.tsx` `useState<ShellWorkspaceId>("studio")`) | The desktop host composition succeeded (registry open; an honest `gameos-compose-failed` banner + real retry exists if not) | **Read**: `StudioDataPort.load()` pulls the authoritative snapshot (packages + gate verdicts, broker policy/grants, tool registrations/jobs) — `packages/desktop/src/renderer/src/gameos/host/studio-adapter.ts`, dispatched by `StudioStore.refresh()` (`packages/game-ui/src/studio-store.ts`) | The five Studio surfaces render the real read models. On first run they are honestly empty: Packages, Avatars, Capabilities and Tools show the first-run empty state with a working **Refresh snapshot** next step; the Session surface shows "No active runtime session" | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` "the host composes the real services and answers empty first snapshots" (empty arrays asserted); `packages/game-ui/src/studio-store.test.ts` refresh success/failure paths; `packages/game-ui/src/view/onboarding.test.ts` (empty-state contract) |
| Game Studio → Packages surface | A package published to the local registry (none on first run) | **Select**: `select-package` store action highlights one record and opens its inspector (gate verdict, license, digest, dependencies, compatibility) — `packages/game-ui/src/studio-actions.ts` | The picked package's full provenance renders (PL-011 read model) | `packages/game-ui/src/studio-actions.test.ts` "select-package jumps to the Packages surface"; `packages/game-ui/src/harness.ts` step `select-package-jumps-surface` |
| Game Studio / Lab / Community | — | **Create/import a game or project: not yet supported.** No module port exposes a create/import operation (`StudioDataPort` is read-only — `packages/game-ui/src/ports.ts`; the Lab/Community command ports carry only research and contribution intents). Missing prerequisite: a typed create/import intent + host wiring into the authoritative lifecycle doors | The empty states say so honestly and offer the real refresh next step instead (no fake buttons) | `packages/game-ui/src/view/onboarding.test.ts` "honest limitations: unsupported operations say so with the missing prerequisite" |

## Journey 2 — Build: combine worlds, packages/assets, avatars, capabilities and tools

| entry point | prerequisites | authoritative operation | result/state | test evidence |
| --- | --- | --- | --- | --- |
| Game Studio → Packages / Avatars / Capabilities / Tools surfaces | Host-composed backing systems (registry, avatar runtime, broker, tool fabric) | **Read-only projection** of the authoritative systems: package records with release-gate verdicts (PL-011), composed avatar definitions with effective capabilities under host restriction (PL-026/R5), the broker's live policy/grant table (PL-026), tool-fabric registrations/jobs/events (PL-019) | The surfaces render whatever the authoritative systems hold. The desktop host composes no avatars and no engine adapters, so those surfaces start at their honest empty states | `packages/game-ui/src/studio-view.test.ts` (all five surfaces over the real demo snapshot); `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` (empty first snapshots; live broker identity asserted) |
| Game Studio → Tools surface | A registered engine/DCC adapter behind the tool fabric | **Register or dispatch a tool: not yet supported from the UI.** The tool-fabric runtime is real but the desktop host registers no adapters and installs an executor that refuses honestly (`createUnavailableToolExecutor` → `executor/adapter-refused`, `packages/desktop/src/renderer/src/gameos/host/adapters.ts`). Missing prerequisite: engine/DCC adapters registered by the host | The Tools empty state states the missing prerequisite; no dispatch control exists on the read-only surface (E6: jobs are durable and only READ here) | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` (registrations empty); `packages/game-ui/src/view/onboarding.test.ts` (tools copy carries the prerequisite) |
| Game Studio → Avatars surface | Avatar composition wired through a Studio port | **Compose/combine avatars, worlds or packages: not yet supported from the UI.** Package publication exists as a registry door (`PackageRegistry.publish`, `packages/package-registry/src/registry.ts`) but no UI control/intent is wired to it. Missing prerequisite: a publish/compose intent wired through a module port into the registry/lifecycle doors | Honest empty states with the real refresh next step | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` "Studio: a real registry publish surfaces through the data port with its gate verdict" (proves the door + read path; the UI intent remains unwired); `packages/game-ui/src/view/onboarding.test.ts` |

## Journey 3 — Run: preview, test, simulate, replay, build where implemented

| entry point | prerequisites | authoritative operation | result/state | test evidence |
| --- | --- | --- | --- | --- |
| Lab → Searches surface → **Request a search** (`gameos-empty-next-step` when empty) | A pinned local project revision (the build commit; `packages/desktop/src/renderer/src/gameos/identity.ts` `localProjectIdentity()`) — without it the host refuses with the typed `invalid-context` code | **Run**: the `request-search` typed intent through `LabCommandPort` → `LabOrganizationService.openSearch` opens a deterministic organization search (same seed → same space, E9); the data port walks the candidate stream append-only — `packages/desktop/src/renderer/src/gameos/host/lab-adapter.ts` | A real search session with its candidate stream (including the generalist baseline) appears after a refresh; the receipt lands in the append-only command log with a "what just happened / what next" hint | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` "Lab: a request-search intent opens a real search and streams the whole space" (+ E10 duplicate replay); `packages/web/gameos-lab/src/lab-store.test.ts` "dispatchCommand appends intent + receipt to the append-only log"; `packages/web/gameos-lab/src/view/onboarding.test.ts` (hint content) |
| Lab → Gaps surface → **Advance rung** | A recurring capability gap recorded by the Lab loop | **Escalate/advance**: the `advance-gap-rung` typed intent → `LabOrganizationService.advanceCapabilityGap` over the frozen R18 ladder; the authoritative gap door owns admission (rung skips, `gap-unknown`, Arena-first-resort rules surface verbatim, E8) | The gap's rung advances one step; refusals stay visible in the log | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` "Lab: gap rung intents refuse with the authoritative codes verbatim"; `packages/web/gameos-lab/src/lab-store.test.ts` (invalid-intent negative paths) |
| Game Studio → Session surface | A host-composed runtime session | **Run a game session / simulate / replay: not yet supported in the desktop product.** The Session surface is a real PL-013 read model (the timeline renders load/observe/act/step/snapshot/restore/replay/terminate results, `packages/game-ui/src/view/runtime-view.ts`), but the desktop host composes no runtime session (`packages/desktop/src/renderer/src/gameos/host/studio-adapter.ts`: "The desktop host composes no runtime session yet"). Missing prerequisite: a runtime session composed behind the Studio data port | The honest "No active runtime session" empty state with the real refresh next step | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` (operations empty); `packages/game-ui/src/view/onboarding.test.ts` (session copy names the prerequisite) |
| Lab → Evidence surface | A wired evaluation-suite directory feeding the simulation service | **Record evaluation evidence: not yet supported from the desktop** — the host owns the suite directory, evidence ledger, observation ledger and replay sink, all honestly EMPTY by composition (`packages/desktop/src/renderer/src/gameos/host/desktop-host.ts`: "no desktop pipeline feeds them yet") | The evidence ledger renders its honest empty state (labeled estimates only, E11) | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` (evidence empty, replayRecords empty); `packages/web/gameos-lab/src/view/onboarding.test.ts` (evidence copy carries the prerequisite) |
| Release/packaging builds (AppImage/.deb) | The TL-owned release pipeline (UX-004) | Product packaging is the release workflow's job, not a game-target build; see Journey 6 for game targets | — | `spec/ux/work-items.md` UX-004; `docs/handoff/RELEASE-AUDIT.md` |

## Journey 4 — Learn: Lab research, evidence, learning, guidance and capability-gap escalation

| entry point | prerequisites | authoritative operation | result/state | test evidence |
| --- | --- | --- | --- | --- |
| Lab → **Refresh read models** (`gameos-empty-next-step` on every no-data Lab surface) | The host Lab services composed | **Read**: `LabDataPort.load()` pulls searches, candidate streams, evidence, learning records, derived signals + both guidance classes, gap summaries and Arena cases through the services' own read doors — `packages/desktop/src/renderer/src/gameos/host/lab-adapter.ts` | The six Lab surfaces render the authoritative read models; first run = the honest empty states with the refresh next step | `packages/web/gameos-lab/src/lab-store.test.ts` (refresh success/failure, selection preservation); `packages/web/gameos-lab/src/view/onboarding.test.ts` (all six surfaces' copy) |
| Lab → Guidance surface | At least one sealed learning cycle | **Derive guidance**: the host derives both E11 epistemic classes (observed-only and with-estimates) from the learning service — `packages/desktop/src/renderer/src/gameos/host/lab-adapter.ts` `deriveSearchGuidance` | Guidance renders in two visually disjoint classes (green observed / teal estimates with method + basis); estimates carry "not ground truth" notes (lock 29) | `packages/web/gameos-lab/src/view-model.test.ts` (guidance classes, E9 determinism); `packages/web/gameos-lab/src/guidance-epistemic.test.ts` |
| Lab → Learning surface | Completed research cycles sealed by the Lab loop | **Read**: sealed, content-addressed learning records + folded dimension-affinity signals (`lab-learning` service) | Learning cycles and signals render when they exist; empty state explains the loop otherwise | `packages/web/gameos-lab/src/view-model.test.ts` "learning: two sealed cycles and the signals state digest" |
| Lab → Arena surface | An external Arena connection configured by the host AND a host-issued escalation decision (R18) | **Arena: read-only, decided cases only** — the UI never sends anything to Arena; the desktop host configures no external connection, so zero cases exist | The honest "No Arena escalation cases" empty state (not a failure) | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` (`arenaCases: []` asserted with the honesty comment); `packages/web/gameos-lab/src/view/onboarding.test.ts` (arena copy carries the prerequisite) |
| Community → Contributions surface (gap-linked work) | A Lab-recorded gap (R18 seam) | **Link contributions to gaps**: submit-contribution accepts a `gapId`; the host's gap seam reads the REAL Lab gap records (`packages/desktop/src/renderer/src/gameos/host/desktop-host.ts` `gaps.factsOf`) | A contribution can address a recorded capability gap; the provenance chain renders the link | `packages/web/gameos-community/src/view-model.test.ts` (gap link rendering); `packages/desktop/src/renderer/src/gameos/host/desktop-host.ts` (gap seam over `organization.listCapabilityGaps`) |

## Journey 5 — Share: publish, contribute, review, provenance and the Git lifecycle

| entry point | prerequisites | authoritative operation | result/state | test evidence |
| --- | --- | --- | --- | --- |
| Community → Contributions surface → **Submit an issue** (`gameos-empty-next-step` when empty) | The local operator tenancy (host-registered subject + maintainer) | **Contribute**: the `submit-contribution` typed intent through `CommunityCommandPort` → `CommunityService.submit` — the payload is a real record, provenance is honest (original origin, or a lineage base the host resolves and REFUSES to fabricate), AI disclosure names the model route (lock 11) — `packages/desktop/src/renderer/src/gameos/host/community-adapter.ts` | A content-addressed contribution (`sha256:<64 hex>`) with full provenance; the receipt (including E10 duplicate replays) lands in the command log; the lifecycle ledger records the intake transition | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` "Community: submit/advance flow through the real service with typed outcomes"; `packages/web/gameos-community/src/community-store.test.ts` (append-only log, duplicates visible); `packages/web/gameos-community/src/view/onboarding.test.ts` |
| Community → Lifecycle surface (a contribution selected on Contributions) | A selected contribution; maintainer rights for verdicts | **Review**: the `advance-contribution` typed intent (`triage` / `review` / verdicts / `withdraw`) → `CommunityService.transition` over the normal Git lifecycle (submitted → triaged → under-review → accepted/rejected/withdrawn; verdicts terminal, corrected work = NEW submission, E10) | The append-only transition ledger grows with authority-stamped, content-addressed records; typed refusals (maintainer rights, cross-tenant, accept-time qualification) surface verbatim (E8) | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` (triage for real; impossible commands refused with the service's own codes); `packages/web/gameos-community/src/view-model.test.ts` (ledger order, walked trail, E8 trust states) |
| Community → Provenance surface (a contribution opened) | A contribution selected | **Read**: the full provenance chain — contributor, origin lineage (with base package/digest when lineage-derived), content address, honest AI disclosure with every model-provenance entry, R18 gap link, E8 trust state | One contribution's complete provenance renders; third-party rows stay "untrusted until qualified at accept" | `packages/web/gameos-community/src/view-model.test.ts` "provenance detail: the full chain of the selected contribution renders" + AI-disclosure test |
| Game Studio → Packages surface | A package published through the registry door (host-side; e.g. an installed content pack) | **Publish from the UI: not yet supported.** `PackageRegistry.publish` exists (`packages/package-registry/src/registry.ts`) and the Community E8 seam reads the same registry, but no UI intent/control is wired to the publish door. Missing prerequisite: a publish intent + port wiring | The Packages empty state names the missing prerequisite honestly; the read path itself is proven real | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` "Studio: a real registry publish surfaces through the data port with its gate verdict" (read path proven); `packages/game-ui/src/view/onboarding.test.ts` (packages copy) |

## Journey 6 — Ship: discover supported output targets (honestly gated)

| entry point | prerequisites | authoritative operation | result/state | test evidence |
| --- | --- | --- | --- | --- |
| Game Studio → Packages surface → a package inspector card | A published package record | **Read**: each package card renders its declared compatibility — runtimes, engines and targets — from the package metadata (`packages/game-ui/src/view/package-view.ts`; rendered in `components/packages-panel.tsx`) | The supported output targets of installed content are discoverable per package, with license + release-gate verdicts beside them | `packages/game-ui/src/studio-view.test.ts` "packages surface: cards carry gate verdicts (R19) and lockfile pins (PL-011)" |
| The frozen target taxonomy (product-level truth) | — | **Read**: the product's frozen Build targets — web, spark, windows, macos, linux, android, ios, steamdeck, xr, dedicated-server, console — map to the six R12 workflow classes (`packages/target-profiles/src/taxonomy.ts`) | The taxonomy is frozen (changes need an Architecture Change Request); "Spark is a target profile, not a content type" | `target-profiles/src/taxonomy.test.ts` (exact target list + class mapping) |
| Any workspace | Vendor-authorized SDKs/toolchains for the target | **Build/package a game for a target from the UI: not yet supported.** The build-orchestration and engine-adapter systems exist as domain packages (`packages/build-orchestrator`, `packages/build-contracts`, `engine-unity/unreal/godot/playcanvas`, `tool-blender`), but the desktop product wires no build port or control, and no engine adapter is registered. Console support stays truthful and SDK-gated (AGENTS.md: "Console support is truthful and SDK-gated") | No build button anywhere — honesty over fake capability. The desktop product's own packaging (AppImage/.deb) is the TL-owned release pipeline (UX-004), separate from game-target builds | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` (no adapters registered; executor refuses with `executor/adapter-refused`); `packages/game-ui/src/view/onboarding.test.ts` (tools copy names the prerequisite) |

## Journey 7 — Configure AI: models, agents, tools and providers (PlayLiquid vocabulary)

| entry point | prerequisites | authoritative operation | result/state | test evidence |
| --- | --- | --- | --- | --- |
| Product top bar → **AI & Agents** (the frozen NEW name of the workbench escape hatch; shell marker `gameos-nav-workbench`, `packages/desktop/src/renderer/src/gameos/shell/shell-chrome.tsx`) | — | **Open**: the escape hatch opens the ZCode workbench — model selection, agents and provider capabilities. AI model selection stays under the ZCode/AI runtime authority (`AGENTS.md`); PlayLiquid never creates a second model-routing authority | AI/model/agent/provider CONFIGURATION lives in the AI & Agents workspace, not in the three game workspaces. The Studio's capabilities empty state suggests it in prose (navigation belongs to the shell) | `packages/desktop/src/renderer/src/gameos/shell/shell-chrome.tsx` (`gameos-nav-workbench` + title "model selection, agents, provider capabilities"); `packages/game-ui/src/view/onboarding.test.ts` (prose vocabulary asserts `AI & Agents`) |
| Game Studio → Capabilities surface | Host-composed broker policy | **Read**: the Capability Broker's live policy, coverage, grant table and tracked evaluations (the broker is THE permission authority for avatar/agent actions) | What avatars/agents may do renders from the authoritative broker; the desktop host declares an empty coverage policy on first run | `packages/game-ui/src/studio-view.test.ts` "broker surface: coverage, grants and tracked evaluations (PL-026)"; `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` (real broker policy + live broker asserted) |
| Lab → Searches surface → request-search | A pinned local project revision | **Model routing (read)**: the host's model catalog carries one opaque route (`route-workbench-local`) resolved by the ZCode model-routing authority — the Lab never sees model names (lock rule 5; `packages/desktop/src/renderer/src/gameos/identity.ts` `LOCAL_MODEL_ROUTE`, used in `packages/desktop/src/renderer/src/gameos/host/lab-adapter.ts` bounds) | Organization searches run under the host's declared model route; no model configuration happens in the Lab | `packages/desktop/src/renderer/src/gameos/host/desktop-host.test.ts` (search bounds accepted); `packages/desktop/src/renderer/src/gameos/identity.ts` (opaque-route documentation) |
| Community → Provenance surface (an AI-disclosed contribution) | An AI-disclosed contribution submitted | **Read**: the honest AI disclosure — every model-provenance entry with model, provider, usage and disclosed state (lock 11) | Model provenance is visible per contribution, never hidden | `packages/web/gameos-community/src/view-model.test.ts` "the AI-disclosed contribution renders its model entries (lock 11)" |

---

## Supported vs not-yet-supported summary

**REAL today (wired to authoritative ports):**
open/refresh read models in all three workspaces; select/inspect entities (packages, avatars,
tool jobs, searches, gaps, contributions); Lab `request-search` (deterministic search open +
candidate streaming, E10/E9); Lab `advance-gap-rung` (R18 ladder); Community
`submit-contribution` (provenance-honest, content-addressed); Community
`advance-contribution` (Git-style lifecycle review); gap-linked contributions (R18 seam);
registry-backed package qualification at accept (E8 seam); AI disclosure + model provenance
rendering; the AI & Agents escape hatch to model/agent/provider configuration.

**Not yet supported (with the missing prerequisite):** game/project create-import (no typed
intent + host wiring); package publish from the UI (publish door exists, no UI intent);
avatar/world composition (no composition operation behind a port); running a game session
(no host-composed runtime session behind the Studio data port); recording evaluation
evidence from the desktop (no wired evaluation-suite directory); Arena connection (no
external provider configured; escalation stays host-decided, R18); tool registration/
dispatch (no adapters registered in the host; executor refuses honestly); game-target
builds from the UI (no build port; engine SDK gating stays truthful, R12).

## Environment limitation (honest, proven precedent RW-001/PR #7)

This station has 3.9 GB RAM; local vite production bundles OOM. Window-level visual proof
of the new empty states is captured at TL integration via the release CI + the UX-003 QA
harness (`qa/desktop-release`), per the frozen cross-workstream contract. The runtime
evidence shipped with UX-002 is therefore STORE-LEVEL: the three module test suites, the
`game-ui` deterministic harness, and this source-cited map.
