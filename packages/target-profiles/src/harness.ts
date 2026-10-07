/**
 * Pure-check harness (PL-008 evidence).
 *
 * Seals and validates the fixture corpus (spark, console, web,
 * dedicated-server), exercises digest integrity and tamper detection,
 * runs the compatibility matrix, and prints a canonical summary. Exit
 * code 0 only when every check passes. Run: `node src/harness.ts`.
 */

import {
  fixtureConsoleRecord,
  fixtureDedicatedServerRecord,
  fixtureSparkRecord,
  fixtureWebRecord,
  fixtureBinding,
} from "./fixtures.ts";
import { TARGETS, targetsOfWorkflowClass } from "./taxonomy.ts";
import { validateTargetProfileRecord } from "./records.ts";
import type { UnsealedTargetProfileRecord } from "./records.ts";
import { sealTargetProfileRecord, verifyTargetProfileDigest } from "./digest.ts";
import { checkEngineBindingCompatibility } from "./compatibility.ts";

const lines: string[] = [];
let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failed += 1;
  lines.push(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` :: ${detail}`}`);
}

// 1. The fixture corpus validates and its digests verify.
const corpus = [
  ["spark", fixtureSparkRecord()],
  ["console", fixtureConsoleRecord()],
  ["web", fixtureWebRecord()],
  ["dedicated-server", fixtureDedicatedServerRecord()],
] as const;
for (const [name, record] of corpus) {
  const validation = validateTargetProfileRecord(record);
  check(`${name} record validates`, validation.ok, validation.ok ? "" : JSON.stringify(validation.reasons.map((r) => r.code)));
  check(`${name} digest verifies`, verifyTargetProfileDigest(record));
  lines.push(`INFO ${name} profile digest: ${record.profileDigest}`);
}

// 2. Tamper detection: mutating a sealed field breaks the digest.
const tampered = { ...fixtureWebRecord(), version: "9.9.9" };
check("tampered record digest fails verification", !verifyTargetProfileDigest(tampered));

// 3. Revisions append: a superseding record keeps its own valid digest.
const web = fixtureWebRecord();
const revision = sealTargetProfileRecord({
  ...(web as unknown as UnsealedTargetProfileRecord),
  version: "1.0.1",
  supersedes: web.profileDigest,
});
check("revision seals with its own digest", verifyTargetProfileDigest(revision));
check("revision validates", validateTargetProfileRecord(revision).ok);

// 4. Compatibility matrix: mutual consent or refusal.
const consoleRecord = fixtureConsoleRecord();
check(
  "vendor engine + console profile compatible",
  checkEngineBindingCompatibility(consoleRecord, fixtureBinding("vendor-engine", ["console"])).ok,
);
const refused = checkEngineBindingCompatibility(consoleRecord, fixtureBinding("vendor-engine", ["web"]));
check(
  "binding without console support is refused",
  !refused.ok && refused.code === "target-not-supported",
);

// 5. Taxonomy: every R12 workflow class is populated.
for (const workflowClass of ["web", "desktop", "mobile", "xr", "dedicated-server", "console"] as const) {
  const targets = targetsOfWorkflowClass(workflowClass);
  check(`workflow class ${workflowClass} has targets`, targets.length > 0, targets.join(","));
}
lines.push(`INFO taxonomy: ${TARGETS.join(",")}`);

lines.push(
  `SUMMARY ${failed === 0 ? "OK" : "FAILED"} checks=${lines.filter((line) => line.startsWith("PASS") || line.startsWith("FAIL")).length} failures=${failed}`,
);
for (const line of lines) {
  console.log(line);
}
process.exitCode = failed === 0 ? 0 : 1;
