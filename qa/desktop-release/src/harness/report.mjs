/**
 * RW-003 harness — result registry, transcript and JSON report writer.
 *
 * Every check records the observed truth (pass/fail/skip + evidence strings).
 * `--baseline-expectations` only ANNOTATES the known pre-integration failures
 * of the current main artifact; it never rewrites a status.
 */
import fs from "node:fs";
import path from "node:path";
import { BASELINE_EXPECTED_FAILURES } from "./config.mjs";

export class Report {
  constructor(options) {
    this.startedAt = new Date();
    this.options = options;
    this.checks = [];
    this.notes = [];
    this.environment = {};
    this.artifacts = {};
  }

  check(id, title, status, detail, evidence = []) {
    const entry = {
      id,
      title,
      status,
      detail: String(detail ?? "").slice(0, 2000),
      evidence: evidence.map((item) => String(item).slice(0, 2000)),
    };
    if (this.options.baselineExpectations && status === "fail" && BASELINE_EXPECTED_FAILURES.includes(id)) {
      entry.expectedFailure = true;
      entry.expectationNote =
        "expected pre-A/B baseline failure on the current main artifact (annotated by --baseline-expectations; the observed status is the truth)";
    }
    this.checks.push(entry);
    return entry;
  }

  note(text) {
    this.notes.push(String(text));
  }

  counts() {
    const counts = { pass: 0, fail: 0, skip: 0, expectedFailure: 0, unexpectedFailure: 0 };
    for (const entry of this.checks) {
      counts[entry.status] = (counts[entry.status] ?? 0) + 1;
      if (entry.status === "fail") {
        if (entry.expectedFailure) counts.expectedFailure += 1;
        else counts.unexpectedFailure += 1;
      }
    }
    return counts;
  }

  exitCode() {
    const counts = this.counts();
    if (counts.unexpectedFailure > 0) return 1;
    if (counts.fail === 0 && counts.skip > 0 && counts.pass === 0) return 2; // nothing ran
    return 0;
  }

  finalize() {
    this.finishedAt = new Date();
    return {
      schema: "playliquid.rw003.smoke-report/1",
      run: {
        startedAt: this.startedAt.toISOString(),
        finishedAt: this.finishedAt.toISOString(),
        argv: this.options.argv,
        artifact: this.options.artifact,
        deb: this.options.deb,
        baselineExpectations: this.options.baselineExpectations,
      },
      environment: this.environment,
      artifacts: this.artifacts,
      counts: this.counts(),
      exitCode: this.exitCode(),
      checks: this.checks,
      notes: this.notes,
    };
  }

  transcript(final) {
    const lines = [];
    lines.push("PlayLiquid GameOS — RW-003 packaged-app smoke run");
    lines.push(`started: ${final.run.startedAt}  finished: ${final.run.finishedAt}`);
    lines.push(`artifact: ${final.run.artifact}`);
    lines.push(`mode: ${final.run.baselineExpectations ? "baseline (expected pre-integration failures annotated)" : "release (all checks must pass)"}`);
    lines.push(`environment: ${JSON.stringify(final.environment)}`);
    lines.push("");
    for (const entry of final.checks) {
      const flag = entry.expectedFailure ? " [EXPECTED BASELINE FAILURE]" : "";
      lines.push(`[${entry.status.toUpperCase()}]${flag} ${entry.id} — ${entry.title}`);
      lines.push(`    ${entry.detail}`);
      for (const evidence of entry.evidence) lines.push(`    · ${evidence}`);
    }
    lines.push("");
    for (const note of final.notes) lines.push(`NOTE: ${note}`);
    lines.push("");
    lines.push(`counts: ${JSON.stringify(final.counts)}  exit code: ${final.exitCode}`);
    return lines.join("\n");
  }

  async write(outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const final = this.finalize();
    fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });
    fs.mkdirSync(path.join(outDir, "logs"), { recursive: true });
    fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(final, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, "transcript.txt"), this.transcript(final));
    return final;
  }
}

/** Save a CDP screenshot (base64) and record its PNG header facts. */
export function saveScreenshot(file, base64) {
  fs.writeFileSync(file, Buffer.from(base64, "base64"));
  const stat = fs.statSync(file);
  const header = pngHeaderInfo(file);
  return {
    file,
    bytes: stat.size,
    png: header.png,
    width: header.width ?? null,
    height: header.height ?? null,
  };
}

/** Parse PNG IHDR for dimensions (no image library needed). */
export function pngHeaderInfo(file) {
  const handle = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(24);
    fs.readSync(handle, buffer, 0, 24, 0);
    const isPng =
      buffer.length >= 24 &&
      buffer.readUInt32BE(0) === 0x89504e47 &&
      buffer.readUInt32BE(12) === 0x49484452;
    if (!isPng) return { png: false };
    return { png: true, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } finally {
    fs.closeSync(handle);
  }
}
