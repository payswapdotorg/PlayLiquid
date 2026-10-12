# @playliquid/lab-organization — Lab organization compiler/search (PL-029)

The organization-search stage of the Game Engineering Lab loop
(spec/architecture.md §Game Engineering Lab, §Lab loop; R16, lock rules
25/26). lab-contracts (PL-006) froze the organization vocabulary and
validation; lab-simulation (PL-028) froze the evaluation engine; THIS
package compiles organizations into evaluation-ready forms and searches the
candidate space:

- **Compilation** (`src/compile.ts`) — a total, deterministic compiler from
  lab-contracts organization descriptors into `CompiledOrganization`
  records: agent slots resolved against avatar-runtime body/capability
  surfaces (the R5 restriction projection is consumed from
  `@playliquid/avatar-runtime`, never duplicated), model assignments carried
  as opaque ZCode seam references, tools, communication/delegation,
  memory topology, budget, scheduling and review structure carried as
  typed compiled records. Every invalid input is a typed kebab-case
  rejection; rejections accumulate in one pass; never throws, never
  `any`. The single-generalist baseline compiles by construction (lock 26).
- **Candidate space** (`src/space.ts`) — typed, bounded dimensions per the
  architecture's list, with explicit enumerations, per-dimension caps and a
  cross-product cap; the space is finite per search request bounds.
- **Search** (`src/search.ts`) — deterministic, seeded traversal (E9):
  a search request opens a cursorable stream of candidates in a stable
  content-derived order; the generalist baseline is always candidate zero;
  the same request always yields the same sequence; non-monotonic cursors
  are typed refusals.
- **Evaluation wiring** (`src/evaluation.ts`) — candidates compile into
  `@playliquid/lab-simulation` evaluation requests and run through the real
  PL-028 engine (the injected evaluation port); results are immutable
  labeled estimates (E10/E11) recorded as tenant-scoped evidence,
  idempotent by content key.
- **Capability gaps** (`src/gaps.ts`) — candidates requiring capabilities
  the current organization lacks produce typed gap findings that resolve
  through lab-contracts' frozen gap ladder; `blocked` is a typed terminal.

Pure domain: the `LabOrganizationService` instance is the single
mutable-state owner (E1); time, body/tool catalogs, evaluation and
persistence live behind injected ports (`src/ports.ts`) with deterministic
in-memory fakes (`src/fakes.ts`). No real model assignment (ZCode is a
host concern), no Arena escalation runtime, no network, no wall clock.

Run: `corepack pnpm install --ignore-scripts`, then `pnpm typecheck`,
`node --test "src/**/*.test.ts"`, `node src/harness.ts`, `pnpm lint`
inside `packages/lab-organization`.
