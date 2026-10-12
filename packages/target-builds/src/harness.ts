/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives the multi-target build journeys over the in-memory fakes
 * (deterministic; every digest derived, never hand-written):
 *  1. multi-target happy path: ONE request over web+windows+android fans out
 *     into three staged build-orchestrator documents (playcanvas web,
 *     unreal windows, unity android) aggregated into ONE record — verdict
 *     succeeded, R19 provenance + verification per target, CAS-shaped
 *     artifacts (E7), content-addressed record (E9);
 *  2. idempotent replay returns the recorded record; the same key with
 *     different content is a typed collision refusal (E6/E8);
 *  3. typed refusals with isolation: unknown-target, console sdk-gated
 *     (lock rule 24), no-engine-for-target — satisfied targets are not
 *     voided (E8);
 *  4. the vendor evidence journey: evidence-missing at resolution, then
 *     awaiting-evidence at the package arc, then resume-skip + on-target
 *     completion (E6, lock rule 24, E11);
 *  5. the R19 closure gate fails per-target builds honestly (never silent);
 *  6. a missing toolchain operation is a truthful E11 failure;
 *  7. cross-tenant reads are typed refusals (R20);
 *  8. snapshot → restore resumes exactly; a torn per-target store is an
 *     honest typed failure, never a silent heal (E8/E6);
 *  9. E9 determinism: two independent services produce identical plans,
 *     build ids and record digests for the same request.
 * Prints deterministic machine-readable JSON and exits non-zero on any
 * unexpected outcome. No IO beyond stdout; no wall clock, no randomness.
 */

import { asTenantId } from "@playliquid/build-orchestrator";
import { asBuildNonce } from "@playliquid/build-contracts";
import { createMemoryBuildStore } from "@playliquid/build-orchestrator";
import type { FanoutStorePort } from "./ports.ts";
import { MultiTargetBuildService } from "./service.ts";
import { verifyMultiTargetRecord } from "./record.ts";
import {
  createServiceRig,
  fixtureMultiTargetRequest,
  fixtureOnTargetEvidence,
  fixturePackageRecord,
  fixtureProfileBundle,
  fixtureVendorSdkEvidence,
} from "./fixtures.ts";

const tenantA = asTenantId("tenant-alpha");
const tenantB = asTenantId("tenant-beta");

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
const failures: string[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
  if (expected !== actual) {
    failures.push(`${name}: expected ${expected}, got ${actual}`);
  }
}

/** The failure code of one target's outcome, or "none" (typed view read). */
function tornFailureOf(targetRecord: { readonly outcomes: ReadonlyArray<{ readonly target: string; readonly outcome: string; readonly failure?: { readonly code: string } }> }, target: string): string {
  const outcome = targetRecord.outcomes.find((entry) => entry.target === target);
  return outcome !== undefined && outcome.outcome === "failed" && outcome.failure !== undefined ? outcome.failure.code : "none";
}

async function main(): Promise<void> {
  // --- 1. multi-target happy path ----------------------------------------
  const rig = createServiceRig();
  const happy = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["windows", "web", "android"] }));
  record("happy-first", "first/succeeded", happy.ok ? `${happy.classification}/${happy.record.verdict}` : `refused:${happy.code}`);
  if (happy.ok) {
    const { record: one } = happy;
    record("happy-engines", "playcanvas:web,unity:android,unreal:windows", one.outcomes.map((outcome) => `${outcome.engineId}:${outcome.target}`).sort().join(","));
    record("happy-evidence", "3/3/pass", `${one.provenance.length}/${one.verification.length}/${one.verification.every((entry) => entry.verdict === "pass") ? "pass" : "mixed"}`);
    record("happy-stages", "5", String(one.provenance[0]?.stageDigests.length));
    record("happy-artifacts", "cas", one.outcomes.every((outcome) => outcome.outcome === "succeeded" && outcome.artifacts.every((artifact) => artifact.bytes.storage === "cas")) ? "cas" : "other");
    record("happy-seal", "verified", verifyMultiTargetRecord(one) ? "verified" : "broken");
    // --- 2. replay + collision -------------------------------------------
    const replay = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["windows", "web", "android"] }));
    record("replay", "replay", replay.ok ? replay.classification : `refused:${replay.code}`);
    const collision2 = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["web"] }));
    record("idempotency-collision", "refused:idempotency-collision", collision2.ok ? "accepted" : `refused:${collision2.code}`);

    // --- 3. typed refusals with isolation ---------------------------------
    const refused = await rig.service.execute(
      tenantA,
      fixtureMultiTargetRequest(rig.lock, { targets: ["television", "console", "steamdeck", "web"], nonce: asBuildNonce("mtb-nonce-0010") }),
    );
    if (refused.ok) {
      record(
        "refusal-battery",
        "sdk-gated:no-engine-for-target:unknown-target+partial",
        `${refused.record.refusals.map((refusal) => refusal.code).join(":")}+${refused.record.verdict}`,
      );
      record("refusal-isolation", "succeeded", refused.record.outcomes.find((outcome) => outcome.target === "web")?.outcome ?? "missing");
    } else {
      record("refusal-battery", "ok", `refused:${refused.code}`);
    }

    // --- 4. vendor evidence journey --------------------------------------
    rig.profiles.publish("web", fixtureProfileBundle("web", { vendorGate: { vendorId: "vendor-x" } }));
    const missingEvidence = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["web"], nonce: asBuildNonce("mtb-nonce-0011") }));
    record(
      "evidence-missing",
      "evidence-missing+refused",
      missingEvidence.ok ? `${missingEvidence.record.refusals[0]?.code ?? "none"}+${missingEvidence.record.verdict}` : `refused:${missingEvidence.code}`,
    );
    const awaiting = await rig.service.execute(
      tenantA,
      fixtureMultiTargetRequest(rig.lock, { targets: ["web", "windows"], nonce: asBuildNonce("mtb-nonce-0012"), evidence: [fixtureVendorSdkEvidence("vendor-x")] }),
    );
    record(
      "awaiting-evidence",
      "awaiting-evidence+succeeded+partial",
      awaiting.ok
        ? `${awaiting.record.outcomes.find((outcome) => outcome.target === "web")?.outcome ?? "none"}+${awaiting.record.outcomes.find((outcome) => outcome.target === "windows")?.outcome ?? "none"}+${awaiting.record.verdict}`
        : `refused:${awaiting.code}`,
    );
    const webAwaiting = awaiting.ok ? awaiting.record.outcomes.find((outcome) => outcome.target === "web") : undefined;
    const resumed = await rig.service.execute(
      tenantA,
      fixtureMultiTargetRequest(rig.lock, {
        targets: ["web", "windows"],
        nonce: asBuildNonce("mtb-nonce-0013"),
        evidence: [fixtureVendorSdkEvidence("vendor-x"), fixtureOnTargetEvidence(webAwaiting?.outcome === "awaiting-evidence" ? (webAwaiting.manifestDigest as string) : "sha256:")],
      }),
    );
    record(
      "evidence-resume",
      "succeeded+skipped+succeeded",
      resumed.ok
        ? `${resumed.record.outcomes.find((outcome) => outcome.target === "web")?.outcome ?? "none"}+${resumed.record.outcomes.find((outcome) => outcome.target === "windows")?.outcome ?? "none"}+${resumed.record.verdict}`
        : `refused:${resumed.code}`,
    );
  }

  // --- 5. R19 closure gate --------------------------------------------------
  const unlicensed = createServiceRig({ records: [fixturePackageRecord("fixture-unlicensed-pack", { licenseStatus: "declared" })] });
  const gated = await unlicensed.service.execute(tenantA, fixtureMultiTargetRequest(unlicensed.lock, { targets: ["web"] }));
  record(
    "r19-closure-gate",
    "failed:closure-provenance-gate-failed",
    gated.ok ? `${gated.record.verdict}:${gated.record.outcomes[0]?.outcome === "failed" ? gated.record.outcomes[0].failure.code : "none"}` : `refused:${gated.code}`,
  );

  // --- 6. E11 toolchain gap -------------------------------------------------
  const missingToolchain = createServiceRig({ operations: ["build", "package"] });
  const toolchain = await missingToolchain.service.execute(tenantA, fixtureMultiTargetRequest(missingToolchain.lock, { targets: ["web"] }));
  record(
    "toolchain-unavailable",
    "failed:toolchain-unavailable",
    toolchain.ok ? `${toolchain.record.verdict}:${toolchain.record.outcomes[0]?.outcome === "failed" ? toolchain.record.outcomes[0].failure.code : "none"}` : `refused:${toolchain.code}`,
  );

  // --- 7. cross-tenant (R20) -------------------------------------------------
  const boundary = createServiceRig();
  const own = await boundary.service.execute(tenantB, fixtureMultiTargetRequest(boundary.lock, { targets: ["web"] }));
  if (own.ok) {
    const crossRead = boundary.service.recordOf(tenantA, own.record.recordId);
    record("cross-tenant-read", "refused:wrong-tenant", crossRead.ok ? "ok" : `refused:${crossRead.code}`);
    const crossPlan = boundary.service.planOf(tenantA, own.record.planId);
    record("cross-tenant-plan", "refused:wrong-tenant", crossPlan.ok ? "ok" : `refused:${crossPlan.code}`);
  } else {
    record("cross-tenant-read", "refused:wrong-tenant", `refused:${own.code}`);
    record("cross-tenant-plan", "refused:wrong-tenant", "skipped");
  }

  // --- 8. snapshot/restore + torn store ---------------------------------------
  const resumeRig = createServiceRig();
  resumeRig.profiles.publish("web", fixtureProfileBundle("web", { vendorGate: { vendorId: "vendor-x" } }));
  const stalled = await resumeRig.service.execute(
    tenantA,
    fixtureMultiTargetRequest(resumeRig.lock, { targets: ["web", "windows"], nonce: asBuildNonce("mtb-nonce-0020"), evidence: [fixtureVendorSdkEvidence("vendor-x")] }),
  );
  if (stalled.ok) {
    const webOutcome = resumeRig.service.durableOutcomesOf(tenantA, stalled.record.planId).find((outcome) => outcome.target === "web");
    const denied = webOutcome === undefined ? [] : [webOutcome.storeKey];
    const tornStores: FanoutStorePort = { open: (key) => (denied.includes(key) ? createMemoryBuildStore() : resumeRig.stores.open(key)) };
    const restored = MultiTargetBuildService.restore(resumeRig.service.snapshot(), {
      catalog: resumeRig.catalog,
      profiles: resumeRig.profiles,
      sources: resumeRig.sources,
      fabric: resumeRig.fabric,
      clock: resumeRig.clock,
      stores: tornStores,
    });
    record("restore-ok", "ok", restored.ok ? "ok" : `refused:${restored.code}`);
    if (restored.ok) {
      const afterTear = await restored.service.execute(
        tenantA,
        fixtureMultiTargetRequest(resumeRig.lock, { targets: ["web", "windows"], nonce: asBuildNonce("mtb-nonce-0021"), evidence: [fixtureVendorSdkEvidence("vendor-x")] }),
      );
      record(
        "torn-store",
        "restore-refused:store-divergence+skipped+partial",
        afterTear.ok
          ? `${tornFailureOf(afterTear.record, "web")}+${afterTear.record.outcomes.find((outcome) => outcome.target === "windows")?.outcome ?? "none"}+${afterTear.record.verdict}`
          : `refused:${afterTear.code}`,
      );
    }
    // The honest resume path (untorn store) completes with the on-target record.
    const honestRig = createServiceRig();
    honestRig.profiles.publish("web", fixtureProfileBundle("web", { vendorGate: { vendorId: "vendor-x" } }));
    const stallAgain = await honestRig.service.execute(
      tenantA,
      fixtureMultiTargetRequest(honestRig.lock, { targets: ["web"], nonce: asBuildNonce("mtb-nonce-0022"), evidence: [fixtureVendorSdkEvidence("vendor-x")] }),
    );
    if (stallAgain.ok) {
      const webAwaiting = stallAgain.record.outcomes.find((outcome) => outcome.target === "web");
      const finish = await honestRig.service.execute(
        tenantA,
        fixtureMultiTargetRequest(honestRig.lock, {
          targets: ["web"],
          nonce: asBuildNonce("mtb-nonce-0023"),
          evidence: [fixtureVendorSdkEvidence("vendor-x"), fixtureOnTargetEvidence(webAwaiting?.outcome === "awaiting-evidence" ? (webAwaiting.manifestDigest as string) : "sha256:")],
        }),
      );
      record(
        "resume-complete",
        "resumed/succeeded",
        finish.ok ? `${finish.classification}/${finish.record.verdict}` : `refused:${finish.code}`,
      );
    }
  } else {
    record("restore-ok", "ok", `refused:${stalled.code}`);
  }

  // --- 9. E9 determinism ------------------------------------------------------
  const left = createServiceRig();
  const right = createServiceRig();
  const leftRun = await left.service.execute(tenantA, fixtureMultiTargetRequest(left.lock, { targets: ["web", "windows"] }));
  const rightRun = await right.service.execute(tenantA, fixtureMultiTargetRequest(right.lock, { targets: ["web", "windows"] }));
  record(
    "determinism",
    "equal-plan/record",
    leftRun.ok && rightRun.ok ? `${leftRun.record.planId === rightRun.record.planId ? "equal-plan" : "different-plan"}/${leftRun.record.recordDigest === rightRun.record.recordDigest ? "record" : "different"}` : "refused",
  );

  console.log(JSON.stringify({ harness: "target-builds", ok: failures.length === 0, steps, failures }, null, 2));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await main();
