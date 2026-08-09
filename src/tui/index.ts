import { createInterface } from "node:readline/promises";

import { applyProject, commitApply, commitUnapply, planUnapply } from "../control/apply.js";
import type { ApplyHost, ApplyPlan, ApplyReceipt, UnapplyPlan } from "../control/apply-contract.js";
import { runDoctor, type DoctorReport } from "../control/doctor.js";
import {
  commitMarketplaceMigration,
  planMarketplaceMigration,
  probeMarketplaceMigration,
  type MarketplaceMigrationPlan,
  type MarketplaceMigrationProbe,
  type MarketplaceMigrationResult,
} from "../control/marketplace-migration.js";
import { readControlStatus, type ControlStatus } from "../control/status.js";
import {
  checkForUpdate,
  commitPackageUpdate,
  detectInstallSource,
  planPackageUpdate,
  type InstallSource,
  type UpdateCheck,
  type UpdateCheckOptions,
  type UpdatePlan,
  type UpdateResult,
} from "../control/update.js";
import { BoundRunService } from "../lifecycle/run-service.js";
import { runForeground } from "../runtime/foreground.js";

export interface TuiSnapshot {
  project: ControlStatus | null;
  projectError: string | null;
  update: UpdateCheck | null;
  updateError: string | null;
  installSource: InstallSource;
  run: Record<string, unknown> | null;
  runError: string | null;
}

export interface TuiIo {
  question(prompt: string): Promise<string>;
  write(output: string): void;
}

export interface TuiServices {
  readControlStatus(project: string, sessionId?: string): Promise<ControlStatus>;
  checkForUpdate(options?: UpdateCheckOptions): Promise<UpdateCheck>;
  detectInstallSource(): Promise<InstallSource>;
  planPackageUpdate(options?: UpdateCheckOptions & { targetVersion?: string; installSource?: InstallSource }): Promise<UpdatePlan>;
  commitPackageUpdate(plan: unknown): Promise<UpdateResult>;
  applyProject(project: string, hosts: readonly ApplyHost[], commit: boolean): Promise<ApplyPlan | ApplyReceipt>;
  commitApply(plan: ApplyPlan): Promise<ApplyReceipt>;
  planUnapply(project: string): Promise<UnapplyPlan>;
  commitUnapply(plan: UnapplyPlan): Promise<{ projectRoot: string; changed: boolean; wouldRemove: readonly string[] }>;
  probeMarketplaceMigration(): Promise<MarketplaceMigrationProbe>;
  planMarketplaceMigration(probe: unknown): MarketplaceMigrationPlan;
  commitMarketplaceMigration(plan: unknown): Promise<MarketplaceMigrationResult>;
  runDoctor(project: string): Promise<DoctorReport>;
}

export interface RunTuiOptions {
  io?: TuiIo;
  services?: Partial<TuiServices>;
  updateOptions?: UpdateCheckOptions;
}

const defaultServices: TuiServices = {
  readControlStatus,
  checkForUpdate,
  detectInstallSource,
  planPackageUpdate,
  commitPackageUpdate,
  applyProject,
  commitApply,
  planUnapply,
  commitUnapply,
  probeMarketplaceMigration,
  planMarketplaceMigration,
  commitMarketplaceMigration,
  runDoctor,
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readTuiSnapshot(
  project: string,
  sessionId?: string,
  runId?: string,
  updateOptions: UpdateCheckOptions = {},
  services: Pick<TuiServices, "readControlStatus" | "checkForUpdate" | "detectInstallSource"> = defaultServices,
): Promise<TuiSnapshot> {
  const [projectResult, updateResult, sourceResult] = await Promise.allSettled([
    services.readControlStatus(project, sessionId),
    services.checkForUpdate({ ...updateOptions, useCache:true, timeoutMs:updateOptions.timeoutMs ?? 1_500 }),
    services.detectInstallSource(),
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
    installSource:sourceResult.status === "fulfilled" ? sourceResult.value : "unknown",
    run,
    runError,
  };
}

function renderOverview(snapshot: TuiSnapshot): string {
  const lines = ["\n=== Overview ==="];
  if (snapshot.project === null) lines.push(`Project: unavailable (${snapshot.projectError ?? "unknown error"})`);
  else {
    const status = snapshot.project;
    lines.push(`Version: ${status.packageVersion}`);
    lines.push(`Install source: ${snapshot.installSource}`);
    lines.push(`Project: ${status.projectRoot}`);
    lines.push(`Applied: ${status.applied ? "yes" : "no"}; ownership: ${status.ownershipValid ? "valid" : "not verified"}`);
    lines.push(`Codex: ${status.integrations.codex.installed ? "installed" : "not installed"}; Claude: ${status.integrations.claude.installed ? "installed" : "not installed"}`);
    lines.push(`MCP/Doctor: ${status.diagnostics.healthy ? "healthy" : "issues found"}`);
    lines.push(status.trellis.bound
      ? `Trellis: ${status.trellis.taskId ?? "bound"} / ${status.trellis.taskStatus ?? "unknown"}`
      : `Trellis: unbound${status.trellis.error === null ? "" : ` (${status.trellis.error})`}`);
  }
  if (snapshot.update !== null) {
    lines.push(snapshot.update.updateAvailable
      ? `Update (${snapshot.update.distTag}): ${snapshot.update.currentVersion} -> ${snapshot.update.latestVersion}`
      : `Update (${snapshot.update.distTag}): current (${snapshot.update.currentVersion})`);
  } else lines.push(`Update: unavailable; offline use continues${snapshot.updateError === null ? "" : ` (${snapshot.updateError})`}`);
  if (snapshot.run !== null) lines.push(`Run: ${String(snapshot.run.run_id)} / ${String(snapshot.run.state)}`);
  if (snapshot.runError !== null) lines.push(`Run: unavailable (${snapshot.runError})`);
  return lines.join("\n");
}

function renderDoctor(report: DoctorReport): string {
  return [`\n=== Doctor ===`, `Status: ${report.healthy ? "healthy" : "issues found"}`, ...report.probes.map((probe) => `- ${probe.command}: ${probe.available ? probe.version ?? "ok" : probe.error ?? "unavailable"}`)].join("\n");
}

function renderApplyPlan(plan: ApplyPlan): string {
  const changes = plan.changes.filter((change) => change.action !== "unchanged");
  return [
    "\nApply preview (no files changed)",
    `Hosts: ${plan.hosts.join(", ")}`,
    `Transaction: ${plan.transactionId}`,
    ...(changes.length === 0 ? ["- no file changes"] : changes.map((change) => `- ${change.action}: ${change.relativePath}`)),
  ].join("\n");
}

function renderMigrationPlan(plan: MarketplaceMigrationPlan): string {
  return [
    "\nMigration preview (no configuration changed)",
    `Transaction: ${plan.transactionId}`,
    `Stale plugin MCP: ${plan.staleMcp ? "yes" : "no"}`,
    ...(plan.commands.length === 0 ? ["- no legacy MTA entries detected"] : plan.commands.map((entry) => `- ${entry.command.join(" ")}`)),
  ].join("\n");
}

function formatCommand(command: readonly string[]): string {
  return command.map((argument) => process.platform === "win32"
    ? `'${argument.replaceAll("'", "''")}'`
    : `'${argument.replaceAll("'", `'"'"'`)}'`).join(" ");
}

async function integrationsPage(project: string, io: TuiIo, services: TuiServices): Promise<void> {
  io.write("\n=== Integrations ===\nCodex and Claude share the npm-managed project integration.\n");
  const action = (await io.question("[a]pply  [u]napply  [m]igrate legacy marketplace  [b]ack > ")).trim().toLowerCase();
  if (action === "a" || action === "apply") {
    const plan = await services.applyProject(project, ["codex", "claude"], false) as ApplyPlan;
    io.write(`${renderApplyPlan(plan)}\n`);
    if ((await io.question("Type APPLY to commit this exact plan > ")).trim() !== "APPLY") {
      io.write("Apply cancelled; no files changed.\n");
      return;
    }
    await services.commitApply(plan);
    io.write("Apply completed for Codex and Claude. Restart the hosts to load the project integration.\n");
  } else if (action === "u" || action === "unapply") {
    const plan = await services.planUnapply(project);
    io.write(`\nUnapply preview (no files changed)\nTransaction: ${plan.transactionId}\n${plan.changes.map((change) => `- restore/remove: ${change.relativePath}`).join("\n")}\n`);
    if ((await io.question("Type UNAPPLY to commit after a fresh drift check > ")).trim() !== "UNAPPLY") {
      io.write("Unapply cancelled; no files changed.\n");
      return;
    }
    await services.commitUnapply(plan);
    io.write("Unapply completed. User-owned bytes were restored.\n");
  } else if (action === "m" || action === "migrate") {
    const plan = services.planMarketplaceMigration(await services.probeMarketplaceMigration());
    io.write(`${renderMigrationPlan(plan)}\n`);
    if (plan.commands.length === 0) return;
    if ((await io.question("Type MIGRATE to remove only the listed MTA entries > ")).trim() !== "MIGRATE") {
      io.write("Migration cancelled; no configuration changed.\n");
      return;
    }
    const result = await services.commitMarketplaceMigration(plan);
    io.write(result.succeeded
      ? "Legacy MTA plugin and marketplace cleanup completed. Run Apply, then Doctor, and restart Codex.\n"
      : `Migration stopped: ${result.error ?? "unknown error"}\n`);
  }
}

async function updatePage(io: TuiIo, services: TuiServices, updateOptions: UpdateCheckOptions): Promise<void> {
  io.write("\n=== Update ===\n");
  const check = await services.checkForUpdate({ ...updateOptions, useCache:false });
  io.write(check.updateAvailable
    ? `Channel: ${check.distTag}\nAvailable: ${check.currentVersion} -> ${check.latestVersion}\n`
    : `Channel: ${check.distTag}\nCurrent: ${check.currentVersion}\n`);
  if (!check.updateAvailable) return;
  const preview = await services.planPackageUpdate({ ...updateOptions, targetVersion:check.latestVersion });
  io.write(`Update preview (nothing installed)\n- source: ${preview.installSource}\n- exact target: ${preview.targetVersion}\n- isolated cache: ${preview.cachePath}\n- command: ${formatCommand(preview.command)}\n`);
  if (!preview.selfUpdateSupported) {
    io.write("This installation source cannot self-update. Run the exact command above.\n");
    return;
  }
  if ((await io.question(`Type UPDATE to install ${preview.targetVersion} > `)).trim() !== "UPDATE") {
    io.write("Update cancelled; nothing installed.\n");
    return;
  }
  const result = await services.commitPackageUpdate(preview);
  if (result.updated) {
    io.write("Update completed. Restart Codex and Claude, then run Apply again to refresh project-managed files.\n");
  } else {
    io.write(`Update failed: ${result.error ?? "unknown error"}. Rollback: ${result.rollbackSucceeded === true ? "succeeded" : result.rollbackSucceeded === false ? "failed" : "not attempted"}.\n`);
  }
}

async function runsPage(project: string, sessionId: string | undefined, io: TuiIo): Promise<string | undefined> {
  io.write("\n=== Runs ===\n");
  const selected = (await io.question("Run ID (blank to go back) > ")).trim();
  if (selected.length === 0) return undefined;
  if (sessionId === undefined) {
    io.write("Runs require --session or MTA_SESSION_ID.\n");
    return selected;
  }
  const service = await BoundRunService.open(project, sessionId, "tui");
  const snapshot = await service.resume(selected);
  io.write(`Run ${selected}: ${String(snapshot.state)}\n`);
  if ((await io.question("Type FOREGROUND to start model Episodes, or press Enter to go back > ")).trim() === "FOREGROUND") {
    const outcome = await runForeground(service, selected);
    io.write(`Foreground stopped at ${outcome.snapshot.state}.\n`);
  }
  return selected;
}

export async function runTui(project: string, sessionId?: string, options: RunTuiOptions = {}): Promise<number> {
  const terminal = options.io === undefined ? createInterface({ input:process.stdin, output:process.stdout }) : null;
  const io: TuiIo = options.io ?? {
    question:(prompt) => terminal!.question(prompt),
    write:(output) => process.stdout.write(output),
  };
  const services: TuiServices = { ...defaultServices, ...options.services };
  let runId: string | undefined;
  const showOverview = async (): Promise<void> => {
    const snapshotServices = {
      readControlStatus:(path: string, selectedSessionId?: string) => services.readControlStatus(path, selectedSessionId),
      checkForUpdate:(updateOptions?: UpdateCheckOptions) => services.checkForUpdate(updateOptions),
      detectInstallSource:() => services.detectInstallSource(),
    };
    io.write(`${renderOverview(await readTuiSnapshot(project, sessionId, runId, options.updateOptions, snapshotServices))}\n`);
  };
  try {
    await showOverview();
    while (true) {
      const action = (await io.question("\n[1] Overview  [2] Integrations  [3] Update  [4] Doctor  [5] Runs  [q] Quit > ")).trim().toLowerCase();
      try {
        if (action === "q" || action === "quit") return 0;
        if (action === "1" || action === "overview" || action === "o") {
          await showOverview();
        } else if (action === "2" || action === "integrations" || action === "i") {
          await integrationsPage(project, io, services);
        } else if (action === "3" || action === "update" || action === "u") {
          await updatePage(io, services, options.updateOptions ?? {});
        } else if (action === "4" || action === "doctor" || action === "d") {
          io.write(`${renderDoctor(await services.runDoctor(project))}\n`);
        } else if (action === "5" || action === "runs" || action === "r") {
          runId = await runsPage(project, sessionId, io);
        }
      } catch (error) {
        io.write(`Operation failed: ${message(error)}\n`);
      }
    }
  } finally {
    terminal?.close();
  }
}
