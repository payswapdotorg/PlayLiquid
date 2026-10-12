# examples/lab-journey — the Lab/Arena/Community reference journey (PL-040)

The fourth reference proof (after `examples/native-game`,
`examples/engine-integration` and `examples/large-world`): the demonstration
that the **product thesis closes END TO END** over real public surfaces only —

> **the Lab discovers → the Arena adjudicates → the Community curates.**

`runCanonicalLabArenaJourney()` (src/journey.ts) walks the whole thesis:

## The walk (phase → real surface → evidence)

| Phase | Real surface exercised | Evidence recorded |
| --- | --- | --- |
| Lab | `lab-learning`'s `createLabLearningJourney` — the REAL PL-029 organization search + PL-028 simulation engine + PL-030 learning service; a typed command port forwards `request-search` / `advance-gap-rung` intents to the authoritative doors (refusals verbatim, E8) | search id, candidate stream size, 2 evaluation runs (E11 `labeled-estimate`/`simulation`), sealed learning records + the signals fold digest, both guidance classes (E11 disjoint), the gap ladder walked one rung at a time **after the authoritative `rung-skip` refusal** |
| Arena | `arena-integration-runtime`'s `ArenaRuntimeService` — the decided escalation command (decision digest re-derived), content-addressed case ingestion of the Lab's OWN walked gap record (R18 rung gate), the orchestration door driving draft→authorized→sent→responded→**ingested**, `labeledEvidence` (E11 `arena-external` classes) | case id, lifecycle trail, admitted evidence package verdict, epistemic labels, the provider-neutral `ArenaEscalationRef` recorded on the ladder's arena rung |
| Community | the REAL `CommunityService` (PL-032) — the Arena outcome submitted as a `replay-backed-report` linked to the gap through a **Lab-backed R18 `GapDirectory` adapter** (live `getCapabilityGap` reads), then triage → review → **accept** with the E8 trust flip (the published lineage base qualifies at accept) | contribution id (content-addressed), the append-only history trail, the provenance chain (lineage-derived base, content digest), the gap-link facts |
| Seal | `package-system`'s `computeDigest` — the single digest authority | 21-entry append-only hash-chained journal (E10) + the content-addressed journey document (E9: run twice, identical) |

## Honest scope statement (E11)

- The services and ports above are the REAL public packages, driven
  **in-process** under `node --test`. There is **no DOM, no rendering, no
  network, no child processes** anywhere in this example — the first test
  asserts the no-DOM fact executably.
- The Arena wire terminates at arena-integration's **deterministic in-memory
  transport fake** — the same `ArenaTransport` port a host-side real provider
  would bind. No real Arena provider exists in this repo and none is claimed.
- The community ports (subject directory, package-registry seam, store, clock)
  are the community package's own deterministic in-memory fakes; the
  **gap seam is real** — it reads the Lab's live ladder state.
- Lab evaluation results are **labeled estimates** (`lab-simulation`), never
  ground truth; Arena-ingested payloads carry the structurally-disjoint
  `arena-external` marker. The example never blurs the two.

## Gates

```bash
cd examples/lab-journey
../../node_modules/.bin/tsc -p .           # typecheck
node --test "src/**/*.test.ts"            # journey + determinism + negative suites
../../node_modules/.bin/oxlint .            # lint
node src/harness.ts                       # runtime evidence harness
```

The harness runs the canonical journey once and prints the journal chain,
the phase facts and the sealed document digest; it exits non-zero if any
stage refuses.
