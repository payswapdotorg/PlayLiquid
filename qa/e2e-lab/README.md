# qa/e2e-lab — the adversarial Lab/Arena/Community end-to-end suite (PL-040)

The negative + determinism counterpart of `examples/lab-journey`: the SAME
public surfaces, walked under a **differently-seeded hostile world** (the
`qa/browser` precedent — a different tenant, different cycles/seeds/
observations, a 4-record evidence ledger, a different ladder route where
every rung is ATTEMPTED, and an AI-DISCLOSED closing contribution — so a
shared fixture bug can never pass both suites at once).

## The suites (file → attack class → representative codes)

| File | Attack class | Representative verbatim codes |
| --- | --- | --- |
| `hostile-journey.test.ts` | The hostile thesis walk itself (E5/E9/E10/E11): Lab loop ×2 cycles → gap ladder (after the authoritative rung-skip refusal) → Arena case driven to `ingested` → community contribution triaged/reviewed/**accepted**; journal append-only + hash-chained; run-twice identical | — (positive walk; `rung-skip` recorded as evidence) |
| `cross-tenant.test.ts` | R20 confused-deputy: the foreign tenant at every Lab door, through the typed port, at every Arena runtime door; the MOVED contributor; the foreign actor | `cross-tenant`, `cross-tenant-contributor`, `cross-tenant-actor`, `unknown-contribution` |
| `forged-escalations.test.ts` | Forged decided commands, undecided/tampered digests, unregistered + cross-tenant source citations, forged sources (arena-first-resort, structurally broken ids, bogus summaries), ladder-skip at the Arena level, tampered persisted documents (E8/E10) | `invalid-command`, `undecided-escalation`, `tampered-decision-digest`, `unknown-source`, `rung-mismatch`, `invalid-source`, `tampered-document` |
| `tampered-evidence.test.ts` | Tampered evidence bundles, fabricated citations/observations, stripped E11 markers, forged learning records, tampered journals | `evidence-digest-mismatch`, `unknown-evidence`, `unknown-observation`, `estimate-label-missing`, identity-oracle failures, broken chains |
| `ladder-guardrails.test.ts` | R18 ladder guardrails: rung skips, Arena-as-first-resort, the blocked terminal, resolved-then-continued, malformed intents refused BEFORE any domain call | `rung-skip`, `arena-first-resort`, `blocked-is-terminal`, `gap-already-resolved`, `gap-unknown`, `invalid-intent` |

Every refusal is asserted with its typed code **verbatim** (E8) and a
non-empty detail; every replayed admission surfaces its FIRST receipt
(E10); the journey runs twice with identical journals and seals (E9).

## Honest scope statement (E11)

- The services and ports above are the REAL public packages (`lab-learning`'s
  journey stack over the real PL-028/029/030 engines, `arena-integration-
  runtime`'s `ArenaRuntimeService`, the real `CommunityService`), driven
  **in-process** under `node --test`. There is **no DOM, no rendering, no
  browser process, no network, no child processes** anywhere in this suite —
  the first test asserts the no-DOM fact executably.
- The Arena wire terminates at arena-integration's **deterministic in-memory
  transport fake** — the same `ArenaTransport` port a host-side real
  provider would bind. No real Arena provider exists in this repo and none
  is claimed.
- The community ports (subject directory, package-registry seam, store,
  clock) are the community package's own deterministic in-memory fakes; the
  **gap seam is real** — it reads the Lab's live ladder state through
  `getCapabilityGap`, never fixture constants.
- Lab evaluation results are **labeled estimates**, never ground truth;
  Arena-ingested payloads carry the structurally-disjoint `arena-external`
  marker. The suite never blurs the two.
- The MOVED-contributor row is a deliberate directory state (membership in
  the hostile tenant + ownership in the foreign tenant) — the same two
  facts the community package's own admission tests drive directly.

## Gates

```bash
cd qa/e2e-lab
../../node_modules/.bin/tsc -p .           # typecheck
node --test "src/**/*.test.ts"            # 42 tests, all must pass
../../node_modules/.bin/oxlint .            # lint
```
