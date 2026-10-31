# ACR-001 — World content-kind and target-profile separation

| Field | Value |
| --- | --- |
| Number | ACR-001 |
| Title | World is the general content concept: Spark is both a World kind and a delivery profile; content kind and target profile are distinct dimensions |
| Status | ACCEPTED — operator-approved in `PRODUCT-NORTH-STAR.md` §Product (PR #14, squash `a6c30053`); TL-executed per `spec/ux/work-items-next.md` PLX-ARCH-001 |
| Raised | 2026-10-31 by TL (PLX-ARCH-001, architecture owner) |
| Base | `main` @ `a6c30053f3898ef88f9d394d09807c6e7749df03` |
| Branch | `tl/PLX-ARCH-001-world-kind-acr` |
| Lock effect | `spec/architecture-lock.md` Amendment 1 (v1.0 → v1.1) |

## 1. Problem (the locked conflation)

The frozen v1.0 architecture encoded Spark exclusively as a target/build
surface. Exact citations (all preserved in place; history is not rewritten):

1. `spec/architecture-lock.md` rule 16 (v1.0): "Spark is a target profile, not
   a second game model."
2. `spec/architecture.md` §Spark: "Spark is a target profile, not a second
   content model." (with the 9:16 / mobile-first / fast-start properties).
3. `spec/architecture.md` build Targets list includes `spark` among
   OS/platform build targets ("web, spark, windows, macos, linux, …") — the
   delivery axis and the OS/build axis are conflated in one list.
4. `spec/requirements.md` R6: "Spark is a 9:16 mobile-first fast-start target."
5. Realized in three managed modules
   (`spec/module-dependency-matrix.md`, historical WO PL-035,
   `spec/work-items.md` — preserved):
   - `@playliquid/runtime-spark` — "the frozen SparkTargetProfile is the
     planning authority" (fast-start planning);
   - `@playliquid/spark` — "the spark-target build surface";
   - `@playliquid/engine-playcanvas` — "the typed web-first engine binding
     (web/spark)".

The operator-approved product contract (merged in PR #14) supersedes this
framing: **a World may be a Spark, game, experience, digital twin or another
extensible kind; Spark is both a valid World kind and may carry a
Spark-specific delivery/target profile; content kind and target profile are
distinct dimensions.**

## 2. Decision

1. **World is the general content concept.** Every top-level content item is
   a World. A World's *content kind* and its *delivery target profile* are
   independent, separately declared dimensions.
2. **Spark has dual citizenship**: it is a registered World content kind AND
   it names a delivery target profile (`spark_vertical`). Neither fact
   implies the other: a Spark-kind World may target `web`/`mobile`/`xr`, and
   a `game`-kind World may be delivered `spark_vertical`.
3. **GameIR remains the single semantic authority** (lock rule 1). No
   competing World, GameIR or Package Graph type may be created by anyone.
   The kind/profile vocabulary is an *additive, typed extension* of the
   existing contracts — not a second model.
4. **The delivery axis is removed from the build-target axis.** The build
   Targets list loses `spark`; Spark delivery is expressed as
   `targetProfile: spark_vertical` over ordinary OS/build targets.

## 3. Canonical vocabulary (registries)

| Registry | Initial values (extensible by future ACR) | Owner |
| --- | --- | --- |
| `WorldKind` | `spark \| game \| experience \| digital_twin \| other` | typed in `@playliquid/game-contracts`, consumed by GameIR/runtime/build |
| `TargetProfile` | `spark_vertical \| web \| desktop \| mobile \| xr \| dedicated_server \| simulation` | same seam |
| Build targets (unchanged axis) | `web, windows, macos, linux, android, ios, steamdeck, xr, dedicated-server, console` | `@playliquid/build-contracts` (unchanged) |

## 4. GameIR reconciliation (single authority, additive only)

`packages/game-ir/src/document.ts` freezes version "1" with the rule that
vocabulary changes require a new version constant **and an ACR** — this
document is that ACR. The node/value vocabulary is unchanged; the extension
is document-level and optional:

- `GameIRDocument` gains an optional `world` declaration
  (`{ kind?: WorldKind; targetProfile?: TargetProfile }`).
- **Legacy compatibility:** documents without the declaration remain valid
  and are equivalent to the pre-ACR world — kind defaults to `game`
  (every pre-ACR document in this repository is a game by construction,
  including the `native-game` example), profile defaults to unspecified
  (build binding driven by the build-target list alone, exactly as before).
- Validators reject unknown kinds/profiles when the declaration is present.
- `irVersion` stays `"1"`: purely additive optional fields; every existing
  document, lockfile and package graph remains valid without rewrite.

## 5. Build/runtime/module reinterpretation (no churn)

- `@playliquid/runtime-spark` keeps `SparkTargetProfile` as the fast-start
  *planning* authority — that is the delivery axis, which this ACR
  reaffirms. Its dispatch becomes (worldKind, targetProfile)-aware: a World
  of any kind with `targetProfile: spark_vertical` routes through it.
- `@playliquid/spark` (build) and `@playliquid/engine-playcanvas`
  (web/spark binding) keep their roles; their inputs gain the typed
  `TargetProfile` dimension additively.
- `examples/native-game` (PL-037) is unaffected: it uses Spark fast-start
  planning as *delivery* (R6), which remains correct under the new model.
- `spec/module-dependency-matrix.md` module entries are unchanged; the
  ACR-001 note is recorded in the next matrix reconciliation wave.

## 6. Migration and compatibility plan

**Phase A (this ACR; documents only — no code changes):** the amendments to
`spec/architecture-lock.md` (Amendment 1), `spec/architecture.md`,
`spec/requirements.md` (R6a), `spec/traceability.md`, the ledger
(`spec/ux/work-items-next.md`) and `spec/PROJECT-STATE.md`.

**Phase B (follow-up Work Orders, dispatched by TL after this ACR merges;
write surfaces frozen per the ledger rules):**

| WO | Scope | Write surface |
| --- | --- | --- |
| PLX-ARCH-002 | Typed `WorldKind`/`TargetProfile` registries in `@playliquid/game-contracts`; GameIR optional `world` declaration + validation; legacy-default + unknown-reject tests; kind/profile independence matrix test; no-duplicate-authority check (single definition site) | `packages/game-contracts`, `packages/game-ir` + colocated tests only |
| PLX-ARCH-003 | (worldKind, targetProfile)-aware dispatch in `runtime-spark`/`spark`/`engine-playcanvas`; `native-game` regression (unchanged behavior); build-contracts typed TargetProfile input | `packages/runtime-spark`, `packages/spark`, `packages/engine-playcanvas`, `packages/build-contracts` + colocated tests only |
| PLX-UX-002 (partial) | Discovery/feed surfaces consume `worldKind` (read model only; no schema change) | per the existing PLX-UX-002 entry |

**Compatibility gates:** no existing document, lockfile or graph is
rewritten; `pnpm program:check` (program closed at PL-045) and
`pnpm architecture:check` (rules unchanged) must stay green; every Phase B WO
lands with source + tests + runtime evidence per the repo truth rule.

## 7. Required evidence (ledger proof for PLX-ARCH-001)

- Accepted ACR: **this document** (operator approval pre-encoded in the
  product contract; TL-executed).
- Migration/compatibility tests: delivered by PLX-ARCH-002/003 (deferred
  honestly — see the ledger status lines; they are the ACR's implementation
  Work Orders, not part of the docs-only Phase A).
- No duplicate World type: enforced by single-definition-site check in
  PLX-ARCH-002 and by lock rules 1/40 (no second authority) thereafter.

## 8. Superseded-statement inventory (all preserved in place)

| Statement | Disposition |
| --- | --- |
| `spec/architecture-lock.md` rule 16 (v1.0) | superseded by Amendment 1 (16′); v1.0 text kept above it |
| `spec/architecture.md` §Spark | superseded by the ACR-001 amendment section appended to that file |
| `spec/architecture.md` build Targets list `spark` entry | removed by the same amendment section (delivery axis ≠ build axis) |
| `spec/requirements.md` R6 | reframed by R6a (R6's delivery properties retained) |
| `spec/work-items.md` PL-035, `spec/traceability.md` Spark row | historical records — untouched |
