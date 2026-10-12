# @playliquid/lab-learning — Lab learning/calibration (PL-030)

The learning layer of the Game Engineering Lab loop
(spec/architecture.md §Game Engineering Lab, §Lab loop: "observed outcome
→ calibration → next search"; R16, R17, R18; lock rules 25–29). lab-contracts
(PL-006) froze the evidence/estimate/gap-ladder vocabulary; lab-simulation
(PL-028) froze the evaluation engine and the calibration seam; lab-organization
(PL-029) froze the compiler/search whose NEXT request this package's guidance
parameterizes. THIS package accumulates Lab cycles over time and learns from
them:

- **Learning-cycle intake** (`src/intake.ts`) — one COMPLETED Lab cycle's
  artifacts arrive as a read-only submission (the observation ledger with its
  appended calibration conclusions, the PL-028 evaluation run records, the
  PL-029 search result digests, the capability-gap records). The admission
  oracle validates every artifact, folds it into a JSON-safe sealed content
  view and derives the CONTENT-ADDRESSED identity (E10 receipt pattern):
  identical cycle content derives the same record id, a duplicate returns the
  existing record as a typed idempotent receipt (`duplicate: true`) — never a
  second copy, never an error; the same cycle re-learned with different
  content is a typed `conflicting-cycle-content` refusal; sequences only move
  forward; a stripped or forged estimate label is a typed
  `estimate-label-missing` refusal (E11, lock 28/29).
- **Signal derivation** (`src/signals.ts`) — a deterministic PURE fold over
  accumulated records producing typed dimension-level outcome affinities
  (which candidate-dimension values co-occurred with which observed-outcome
  summaries). No wall clock, no randomness, no IO; enumeration order is
  content-derived (E9) and the state digest makes determinism observable.
- **Gap learning** (`src/gaps.ts`, R18) — RECURRING gap-ladder findings
  aggregated across cycles into typed summaries classified by the frozen
  rung (existing → alternate → package/platform → user/community → Arena →
  blocked) with recurrence counts — never silently skipped, never
  auto-escalated (recording and typing only; advancing a rung is
  lab-organization's gap door and the host's decision).
- **Search guidance** (`src/guidance.ts`) — the top-level product: a typed
  guidance object that parameterizes lab-organization's next search request
  (dimension bounds adjustments with ordering hints, baseline promotion
  notes, a deterministic seed hint), derived ONLY from the learning state.
  Epistemic discipline is STRUCTURAL (E11): observed-evidence guidance and
  labeled-estimate guidance are disjoint types; a stripped or forged marker
  breaks the content-addressed digest and is a typed refusal.

Immutability discipline (E10): this package NEVER mutates any lab-contracts
ledger — all inputs are read-only views; learning records are themselves
immutable once appended; there is no update, revise or rewrite operation
anywhere. Tenancy (R20): records, signals and guidance are tenant-scoped;
cross-tenant access is a typed refusal.

Pure domain: the `LabLearningService` instance is the single mutable-state
owner (E1); time and persistence live behind injected ports (`src/ports.ts`)
with deterministic in-memory fakes (`src/fakes.ts`) that wire the REAL PL-029
search and PL-028 evaluation engines for tests and the harness. No
persistence beyond in-memory stores, no network, no real Arena escalation,
no ZCode integration, no re-implementation of lab-simulation's evaluation or
lab-organization's compiler/search.

Run: `corepack pnpm install --ignore-scripts`, then `pnpm typecheck`,
`node --test "src/**/*.test.ts"`, `node src/harness.ts`, `pnpm lint`
inside `packages/lab-learning`.
