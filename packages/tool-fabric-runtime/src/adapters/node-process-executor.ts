/**
 * Module role: the node process adapter — a REAL ToolExecutorPort
 * implementation that runs a configured command as a child process (the
 * architecture's "generic CLI/process" adapter class). The validated call
 * input is piped to the process stdin as JSON; the process's stdout is
 * parsed as JSON and becomes the tool output. This is the ONLY module in
 * the package that touches node:child_process (E3: IO stays behind the
 * port). Resource caps are typed, deterministic decisions: the effective
 * deadline kills the process (timeout), cancellation kills it (cancelled),
 * and stdout beyond maxOutputBytes kills it (typed refusal).
 *
 * Default runner: `node -e <echo runner>` — a provider-neutral round-trip
 * used by tests and as the documented default.
 *
 * Implements: PL-019 node process adapter behind ToolExecutorPort; E11 —
 * the adapter truthfully reports process failures, not simulated ones.
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { ExecutorDispatch, ExecutorResult, ToolExecutorPort } from "../domain/ports.ts";

export const DEFAULT_OUTPUT_CAP_BYTES = 4 * 1024 * 1024;

const ECHO_RUNNER = [
  "let s='';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data',(d)=>{s+=d;});",
  "process.stdin.on('end',()=>{",
  "try{const v=JSON.parse(s);process.stdout.write(JSON.stringify({echo:v}));}",
  "catch(e){process.stderr.write(String((e&&e.message)||e));process.exit(1);}",
  "});",
].join("");

export interface NodeProcessExecutorOptions {
  /** Executable to run (default: the current node binary). */
  readonly command?: string;
  /** Fixed arguments for the command (default: the echo runner). */
  readonly args?: readonly string[];
  /** Hard cap on collected stdout bytes (default 4 MiB). */
  readonly maxOutputBytes?: number;
}

export interface NodeProcessExecutor extends ToolExecutorPort {
  /** Number of child processes actually spawned (observation for tests). */
  readonly spawnedCount: number;
}

/** Creates a real child-process tool executor. Never throws; typed results. */
export function createNodeProcessExecutor(options: NodeProcessExecutorOptions = {}): NodeProcessExecutor {
  const command = options.command ?? process.execPath;
  const args = Object.freeze([...(options.args ?? ["-e", ECHO_RUNNER])]);
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_OUTPUT_CAP_BYTES;
  let spawnedCount = 0;

  async function execute(dispatch: ExecutorDispatch): Promise<ExecutorResult> {
    if (dispatch.cancellation !== undefined && dispatch.cancellation.requested) {
      return { outcome: "cancelled", reason: dispatch.cancellation.reason ?? "caller-requested" };
    }
    const deadline = dispatch.deadline;
    if (deadline !== undefined && Date.now() >= deadline.atEpochMs) {
      return { outcome: "timeout", deadline };
    }

    return await new Promise<ExecutorResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
      } catch (error) {
        resolve({
          outcome: "refused",
          code: "executor/adapter-failed",
          message: `failed to spawn ${command}: ${describe(error)}`,
        });
        return;
      }
      spawnedCount += 1;

      let stdout = "";
      let stderr = "";
      let bytes = 0;
      let capped = false;
      let settled = false;
      let childClosed = false;

      const killTimer: ReturnType<typeof setTimeout> | undefined =
        deadline === undefined
          ? undefined
          : setTimeout(() => {
              finish({ outcome: "timeout", deadline });
            }, Math.max(0, deadline.atEpochMs - Date.now()));
      const unsubscribe = dispatch.cancellation?.onCancel(() => {
        finish({ outcome: "cancelled", reason: dispatch.cancellation?.reason ?? "caller-requested" });
      });

      function finish(result: ExecutorResult): void {
        if (settled) {
          return;
        }
        settled = true;
        if (killTimer !== undefined) {
          clearTimeout(killTimer);
        }
        unsubscribe?.();
        if (!childClosed) {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }
        resolve(result);
      }

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        bytes += chunk.length;
        if (bytes > maxOutputBytes) {
          capped = true;
          child.kill("SIGTERM");
          return;
        }
        stdout += chunk;
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk.length > 400 ? `${chunk.slice(0, 400)}…` : chunk;
      });

      child.on("error", (error) => {
        finish({
          outcome: "refused",
          code: "executor/adapter-failed",
          message: `process error: ${describe(error)}`,
        });
      });

      child.on("close", (code) => {
        childClosed = true;
        if (capped) {
          finish({
            outcome: "refused",
            code: "executor/adapter-failed",
            message: `process stdout exceeded the resource cap (${maxOutputBytes} bytes)`,
          });
          return;
        }
        if (code !== 0) {
          finish({
            outcome: "refused",
            code: "executor/adapter-failed",
            message: `process exited with code ${code ?? "unknown"}${stderr === "" ? "" : `: ${stderr.trim()}`}`,
          });
          return;
        }
        try {
          const output: unknown = JSON.parse(stdout);
          finish({ outcome: "executed", output, finishedAt: Date.now() });
        } catch (error) {
          finish({
            outcome: "refused",
            code: "executor/adapter-failed",
            message: `process stdout was not valid JSON: ${describe(error)}`,
          });
        }
      });

      try {
        child.stdin?.write(JSON.stringify(dispatch.input ?? null));
        child.stdin?.end();
      } catch (error) {
        finish({
          outcome: "refused",
          code: "executor/invalid-dispatch",
          message: `failed to write process stdin: ${describe(error)}`,
        });
      }
    });
  }

  return Object.freeze({ execute, get spawnedCount() { return spawnedCount; } });
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
