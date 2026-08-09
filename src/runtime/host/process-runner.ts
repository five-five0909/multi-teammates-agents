import { spawn, type ChildProcess } from "node:child_process";

export type ProcessTerminationReason = "completed" | "timeout" | "cancelled";

export interface ProcessRunRequest {
  episodeId: string;
  executable: string;
  args: readonly string[];
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  stdin: string;
  timeoutMs: number;
  maxStdoutChars: number;
  maxStderrChars: number;
}

export interface ProcessRunResult {
  exitCode: number | null;
  terminationReason: ProcessTerminationReason;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  spawnError?: string;
  cleanupError?: string;
}

interface ActiveProcess {
  child: ChildProcess;
  closed: Promise<void>;
  terminationReason: ProcessTerminationReason;
  cleanupError?: string;
  terminating?: Promise<boolean>;
}

class BoundedText {
  private value = "";
  public truncated = false;

  public constructor(private readonly limit: number) {}

  public append(chunk: string): void {
    this.value += chunk;
    if (this.value.length <= this.limit) return;
    this.value = this.value.slice(-this.limit);
    this.truncated = true;
  }

  public text(): string {
    return this.value;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runTaskkill(pid: number, force: boolean): Promise<void> {
  await new Promise<void>((resolveTaskkill, rejectTaskkill) => {
    const args = ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
    const child = spawn("taskkill", args, { shell:false, stdio:"ignore", windowsHide:true });
    child.once("error", rejectTaskkill);
    child.once("close", (code) => {
      if (code === 0 || code === 128 || code === 255) resolveTaskkill();
      else rejectTaskkill(new Error(`taskkill exited with code ${String(code)}`));
    });
  });
}

async function waitForClose(closed: Promise<void>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    closed.then(() => true),
    new Promise<false>((resolveWait) => {
      const timer = setTimeout(() => resolveWait(false), timeoutMs);
      timer.unref();
    }),
  ]);
}

export class ProcessRunner {
  private readonly active = new Map<string, ActiveProcess>();

  public async run(request: ProcessRunRequest, signal?: AbortSignal): Promise<ProcessRunResult> {
    if (this.active.has(request.episodeId)) throw new Error(`episode process already active: ${request.episodeId}`);
    if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1) throw new Error("process timeout must be positive");
    if (request.maxStdoutChars < 1 || request.maxStderrChars < 1) throw new Error("process output limits must be positive");
    if (signal?.aborted === true) {
      return {
        exitCode:null, terminationReason:"cancelled", durationMs:0, stdout:"", stderr:"",
        stdoutTruncated:false, stderrTruncated:false,
      };
    }

    const started = Date.now();
    const stdout = new BoundedText(request.maxStdoutChars);
    const stderr = new BoundedText(request.maxStderrChars);
    let exitCode: number | null = null;
    let spawnError: string | undefined;
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolvePromise) => { resolveClosed = resolvePromise; });
    const child = spawn(request.executable, [...request.args], {
      cwd:request.cwd,
      env:request.environment ?? process.env,
      shell:false,
      stdio:["pipe", "pipe", "pipe"],
      windowsHide:true,
      detached:process.platform !== "win32",
    });
    const active: ActiveProcess = { child, closed, terminationReason:"completed" };
    this.active.set(request.episodeId, active);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => stdout.append(chunk));
    child.stderr?.on("data", (chunk: string) => stderr.append(chunk));
    child.once("error", (error) => { spawnError = error.message; });
    child.once("close", (code) => {
      exitCode = code;
      resolveClosed();
    });

    const onAbort = (): void => { void this.terminate(request.episodeId, "cancelled"); };
    signal?.addEventListener("abort", onAbort, { once:true });
    const timeout = setTimeout(() => { void this.terminate(request.episodeId, "timeout"); }, request.timeoutMs);
    timeout.unref();
    child.stdin?.once("error", () => undefined);
    child.stdin?.end(request.stdin);

    await closed;
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
    this.active.delete(request.episodeId);
    return {
      exitCode,
      terminationReason:active.terminationReason,
      durationMs:Date.now() - started,
      stdout:stdout.text(),
      stderr:stderr.text(),
      stdoutTruncated:stdout.truncated,
      stderrTruncated:stderr.truncated,
      ...(spawnError === undefined ? {} : { spawnError }),
      ...(active.cleanupError === undefined ? {} : { cleanupError:active.cleanupError }),
    };
  }

  public async cancel(episodeId: string): Promise<{ episodeId: string; found: boolean; terminated: boolean }> {
    const found = this.active.has(episodeId);
    const terminated = found ? await this.terminate(episodeId, "cancelled") : false;
    return { episodeId, found, terminated };
  }

  private async terminate(episodeId: string, reason: Exclude<ProcessTerminationReason, "completed">): Promise<boolean> {
    const active = this.active.get(episodeId);
    if (active === undefined) return false;
    if (active.terminationReason === "completed") active.terminationReason = reason;
    if (active.terminating !== undefined) return active.terminating;
    active.terminating = this.terminateTree(active).catch((error: unknown) => {
      active.cleanupError = errorMessage(error);
      return false;
    });
    return active.terminating;
  }

  private async terminateTree(active: ActiveProcess): Promise<boolean> {
    const pid = active.child.pid;
    if (pid === undefined || active.child.exitCode !== null || active.child.signalCode !== null) return true;
    if (process.platform === "win32") {
      await runTaskkill(pid, true);
      if (await waitForClose(active.closed, 3_000)) return true;
      throw new Error(`process tree ${String(pid)} did not exit after taskkill`);
    }
    try { process.kill(-pid, "SIGTERM"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    if (await waitForClose(active.closed, 1_500)) return true;
    try { process.kill(-pid, "SIGKILL"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    if (await waitForClose(active.closed, 3_000)) return true;
    throw new Error(`process group ${String(pid)} did not exit after SIGKILL`);
  }
}
