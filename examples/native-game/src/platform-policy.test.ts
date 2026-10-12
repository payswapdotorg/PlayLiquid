/**
 * PLATFORM-POLICY TESTS (PL-037; R7 — lock rule 18) — the game DECLARES
 * its events and policies and CONSUMES the platform through the services'
 * public contracts; nothing is re-implemented locally:
 *
 * - every service-side registration is a PROJECTION of the GameIR
 *   document's capability-declaration nodes (one source of truth);
 * - the game's event kinds are minted through platform-contracts' own
 *   authority — and the reserved `platform.` namespace is refused THERE,
 *   so the game structurally cannot mint platform authority kinds;
 * - the canonical playthrough's platform outcomes are all readable
 *   through the services' PUBLIC read doors (query/progressOf/graphView/
 *   balanceOf/readReport) — decided by the platform, never the client;
 * - the module manifest (PL-010) honestly lists every workspace package
 *   the src imports (the promotion-cycle discipline, made structural).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { asGameEventKind } from "../../../packages/platform-contracts/src/index.ts";
import { runCanonicalPlaythrough } from "./playthrough.ts";
import { nativeGameModule } from "./module.ts";
import {
  LUMEN_ACHIEVEMENTS,
  LUMEN_BOARD,
  LUMEN_BOARD_BINDING,
  LUMEN_SETTLEMENT,
  LUMEN_SOCIAL_POLICY,
  declaredIntegrityPosture,
  declaredMultiplayerPolicy,
  declaredReplayPolicy,
  declaredRewardsPolicy,
  shapeDigestOf,
} from "./platform-policy.ts";
import { EVENT_TYPES, PLATFORM_EVENT_KINDS } from "./events.ts";
import { TENANT, PLAYER_ONE, PLAYER_TWO } from "./ids.ts";

const run = await runCanonicalPlaythrough();
const document = run.composition.document;

test("policy (R7): the service registrations project the document's capability nodes verbatim", () => {
  assert.deepEqual(declaredMultiplayerPolicy(document), {
    topology: "authoritative-server",
    maxPlayersPerSession: 4,
    sessionModel: "ad-hoc",
  });
  assert.deepEqual(declaredReplayPolicy(document), {
    capture: "intent-log",
    determinismRequired: true,
    consumers: ["player", "qa", "integrity"],
  });
  assert.deepEqual(declaredRewardsPolicy(document), {
    mode: "points",
    settlement: "platform",
    clientAuthoritative: false,
  });
  assert.equal(declaredIntegrityPosture(document), "report-only");
  // The board's metric/ordering are the capability node's own policy.
  assert.equal(LUMEN_BOARD.tenant, TENANT);
  assert.equal(LUMEN_BOARD.metric, "run.score");
  assert.equal(LUMEN_BOARD.ordering, "descending");
  assert.deepEqual(LUMEN_SOCIAL_POLICY.declaredGraphs, ["friends"]);
});

test("policy (R7): event bindings cite platform-minted kinds; the platform namespace is refused by the authority", () => {
  assert.equal(LUMEN_BOARD_BINDING.eventKind, PLATFORM_EVENT_KINDS.runCompleted);
  for (const definition of LUMEN_ACHIEVEMENTS) {
    for (const binding of definition.bindings) {
      assert.equal(binding.capability, "achievements");
    }
  }
  assert.equal(LUMEN_SETTLEMENT.eventKind, PLATFORM_EVENT_KINDS.runCompleted);
  assert.equal(LUMEN_SETTLEMENT.entitlementKind, "score-shard");
  assert.equal(LUMEN_SETTLEMENT.minIntegrityConfidence, 0.5);
  assert.equal(LUMEN_SETTLEMENT.valueShapeDigest, shapeDigestOf(EVENT_TYPES.runCompleted));
  // The minting AUTHORITY refuses the reserved platform namespace — the
  // game structurally cannot declare platform authority kinds (lock 18).
  assert.equal(asGameEventKind("platform.authority.claim"), undefined);
  for (const kind of Object.values(PLATFORM_EVENT_KINDS)) {
    assert.ok(!String(kind).startsWith("platform."), "game kinds never borrow the platform namespace");
  }
});

test("policy (R7): the playthrough's platform outcomes are readable through the services' public doors", () => {
  const rig = run.rig;

  // Leaderboard: the PLATFORM ranked the authoritative score record.
  const page = rig.leaderboard.query(PLAYER_ONE, {
    tenant: TENANT,
    leaderboard: LUMEN_BOARD.leaderboard,
    window: { offset: 0, limit: 10 },
  });
  assert.ok(!("code" in page), "the query read is admitted");
  if ("code" in page) return;
  assert.equal(page.totalEntries, 1);
  const entry = page.entries[0]!;
  assert.equal(String(entry.subject), String(PLAYER_ONE));
  assert.equal(entry.rank, 1);
  assert.equal(entry.score, 270);

  // Achievements: the SERVICE decided progress and unlock from evidence.
  const hoarder = rig.achievements.progressOf(PLAYER_ONE, TENANT, PLAYER_ONE, LUMEN_ACHIEVEMENTS[0]!.achievementId);
  assert.ok(!("code" in hoarder), "the progress read is admitted");
  if ("code" in hoarder) return;
  assert.equal(hoarder.current, 3);
  assert.equal(hoarder.unlocked, true);
  const finisher = rig.achievements.progressOf(PLAYER_ONE, TENANT, PLAYER_ONE, LUMEN_ACHIEVEMENTS[1]!.achievementId);
  if ("code" in finisher) throw new Error("finisher progress refused");
  assert.equal(finisher.unlocked, true);

  // Social: the graph read model carries the recorded follow edge.
  const graph = rig.social.graphView(TENANT, PLAYER_ONE, PLAYER_ONE);
  assert.ok(!("code" in graph), "the graph read is admitted");
  if ("code" in graph) return;
  assert.deepEqual(graph.following.map(String), [String(PLAYER_TWO)]);

  // Economy: the settled balance is the platform's ledger view.
  const balance = rig.economy.balanceOf(PLAYER_ONE, TENANT, PLAYER_ONE, LUMEN_SETTLEMENT.entitlementKind);
  assert.ok(!("code" in balance), "the balance read is admitted");
  if ("code" in balance) return;
  assert.equal(balance.balance, 10);
  assert.ok(balance.entries.length >= 1, "the grant row is journaled (E10)");

  // Integrity: the report the verdict rests on is readable.
  const receipt = run.platform.integrity;
  if (!receipt.accepted) throw new Error("the playthrough's evaluation was refused");
  const report = rig.integrity.readReport(PLAYER_ONE, TENANT, receipt.receipt.reportId);
  assert.ok(report.ok, "the report read is admitted");
  if (report.ok) assert.equal(String(report.report.reportId), String(receipt.receipt.reportId));
});

test("policy (R7): the module manifest honestly lists every workspace package the src imports", () => {
  const srcDir = fileURLToPath(new URL("./", import.meta.url));
  const files = readdirSync(srcDir).filter((name) => name.endsWith(".ts"));
  assert.ok(files.length > 20, "the src tree is scanned");
  const imported = new Set<string>();
  const pattern = /["']\.\.\/\.\.\/\.\.\/packages\/([a-z0-9-]+)\/src\//g;
  for (const name of files) {
    const text = readFileSync(join(srcDir, name), "utf8");
    for (const match of text.matchAll(pattern)) {
      imported.add(match[1]!);
    }
  }
  const declared = new Set<string>(nativeGameModule.requires);
  const unlisted = [...imported].filter((name) => !declared.has(name)).sort();
  const unused = [...declared].filter((name) => !imported.has(name)).sort();
  assert.deepEqual(unlisted, [], "every imported package is declared in the module manifest");
  assert.deepEqual(unused, [], "every declared package is actually imported (no decoration)");
});
