import { createInterface } from "node:readline/promises";

import { runDoctor, type DoctorReport } from "../control/doctor.js";
import { readProjectStatus, type ProjectStatus } from "../control/status.js";
import { checkForUpdate, type UpdateCheck, type UpdateCheckOptions } from "../control/update.js";
import { BoundRunService } from "../lifecycle/run-service.js";
import { runForeground } from "../runtime/foreground.js";

export interface TuiSnapshot {
  project: ProjectStatus | null;
  projectError: string | null;
  update: UpdateCheck | null;
  updateError: string | null;
  run: Record<string, unknown> | null;
  runError: string | null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readTuiSnapshot(
  project: string,
  sessionId?: string,
  runId?: string,
  updateOptions: UpdateCheckOptions = {},
): Promise<TuiSnapshot> {
  const [projectResult, updateResult] = await Promise.allSettled([
    readProjectStatus(project),
    checkForUpdate({ ...updateOptions, useCache:true, timeoutMs:updateOptions.timeoutMs ?? 1_500 }),
  ]);
  let run: Record<string, unknown> | null = null;
  let runError: string | null = null;
  if (runId !== undefined) {
    try {
      if (sessionId === undefined) throw new Error("run status requires --session or MTA_SESSION_ID");
      const service = await BoundRunService.open(project, sessionId, "tui");
      run = await service.resume(runId);
    } catch (error) {
      runError = message(error);
    }
  }
  return {
    project:projectResult.status === "fulfilled" ? projectResult.value : null,
    projectError:projectResult.status === "rejected" ? message(projectResult.reason) : null,
    update:updateResult.status === "fulfilled" ? updateResult.value : null,
    updateError:updateResult.status === "rejected" ? message(updateResult.reason) : null,
    run,
    runError,
  };
}

function renderSnapshot(snapshot: TuiSnapshot): string {
  const lines = ["Multi Teammates Agents"];
  if (snapshot.project === null) lines.push(`Project: unavailable (${snapshot.projectError ?? "unknown error"})`);
  else {
    lines.push(`Project: ${snapshot.project.projectRoot}`);
    lines.push(`Applied: ${snapshot.project.applied ? "yes" : "no"}; ownership: ${snapshot.project.ownershipValid ? "valid" : "not verified"}`);
  }
  if (snapshot.update !== null) {
    lines.push(snapshot.update.updateAvailable
      ? `Update: ${snapshot.update.currentVersion} → ${snapshot.update.latestVersion}`
      : `Update: current (${snapshot.update.currentVersion})`);
  } else lines.push("Update: unavailable (offline use continues)");
  if (snapshot.run !== null) lines.push(`Run: ${String(snapshot.run.run_id)} / ${String(snapshot.run.state)}`);
  if (snapshot.runError !== null) lines.push(`Run: unavailable (${snapshot.runError})`);
  return lines.join("\n");
}

function renderDoctor(report: DoctorReport): string {
  return [`Doctor: ${report.healthy ? "healthy" : "issues found"}`, ...report.probes.map((probe) => `- ${probe.command}: ${probe.available ? probe.version ?? "ok" : probe.error ?? "unavailable"}`)].join("\n");
}

export async function runTui(project: string, sessionId?: string): Promise<number> {
  const terminal = createInterface({ input:process.stdin, output:process.stdout });
  let runId: string | undefined;
  try {
    while (true) {
      process.stdout.write(`\n${renderSnapshot(await readTuiSnapshot(project, sessionId, runId))}\n\n`);
      const action = (await terminal.question("[r]efresh  run [s]tatus  [f]oreground  [d]octor  check [u]pdate  [q]uit > ")).trim().toLowerCase();
      if (action === "q" || action === "quit") return 0;
      if (action === "s" || action === "status") {
        runId = (await terminal.question("Run ID > ")).trim() || undefined;
      } else if (action === "f" || action === "foreground") {
        const selected = (await terminal.question("Run ID > ")).trim();
        if (selected.length === 0) continue;
        if (sessionId === undefined) {
          process.stdout.write("Foreground requires --session or MTA_SESSION_ID.\n");
          continue;
        }
        const confirmation = (await terminal.question(`Type ${selected} to start model Episodes > `)).trim();
        if (confirmation !== selected) {
          process.stdout.write("Foreground cancelled.\n");
          continue;
        }
        const service = await BoundRunService.open(project, sessionId, "tui");
        const outcome = await runForeground(service, selected);
        runId = selected;
        process.stdout.write(`Foreground stopped at ${outcome.snapshot.state}.\n`);
      } else if (action === "d" || action === "doctor") {
        process.stdout.write(`${renderDoctor(await runDoctor(project))}\n`);
      } else if (action === "u" || action === "update") {
        try {
          const update = await checkForUpdate({ useCache:false });
          process.stdout.write(update.updateAvailable ? `Update available: ${update.latestVersion}\n` : "No update available.\n");
        } catch (error) {
          process.stdout.write(`Update check unavailable: ${message(error)}\n`);
        }
      }
    }
  } finally {
    terminal.close();
  }
}
