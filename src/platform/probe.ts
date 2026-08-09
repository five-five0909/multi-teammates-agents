import { spawn } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { delimiter, dirname, extname, isAbsolute, resolve } from "node:path";

export interface CommandProbe {
  readonly command: string;
  readonly resolvedCommand?: string;
  readonly available: boolean;
  readonly version?: string;
  readonly error?: string;
}

export interface ResolvedCommand {
  readonly executable: string;
  readonly prefixArgs: readonly string[];
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function resolveWindowsShim(path: string): Promise<ResolvedCommand> {
  const content = await readFile(path, "utf8");
  const matches = [...content.matchAll(/"%dp0%\\([^"\r\n]+\.(?:js|exe))"/giu)];
  const assignedCli = /SET\s+"NPM_CLI_JS=%~dp0\\([^"\r\n]+\.js)"/iu.exec(content)?.[1];
  const target = matches.at(-1)?.[1] ?? assignedCli;
  if (!target) {
    throw new Error(`unsupported Windows command shim: ${path}`);
  }
  const resolvedTarget = resolve(dirname(path), target);
  await access(resolvedTarget);
  if (extname(resolvedTarget).toLowerCase() === ".exe") {
    return { executable: resolvedTarget, prefixArgs: [] };
  }
  return { executable: process.execPath, prefixArgs: [resolvedTarget] };
}

export async function resolveCommand(
  command: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedCommand> {
  if (isAbsolute(command)) {
    if (!(await isFile(command))) throw new Error(`command not found: ${command}`);
    return extname(command).toLowerCase() === ".cmd"
      ? resolveWindowsShim(command)
      : { executable: command, prefixArgs: [] };
  }

  const paths = (environment.PATH ?? environment.Path ?? "").split(delimiter).filter(Boolean);
  const suffixes = process.platform === "win32"
    ? [".exe", ".com", ".cmd", ".bat", ""]
    : [""];
  for (const directory of paths) {
    for (const suffix of suffixes) {
      const candidate = resolve(directory, `${command}${suffix}`);
      if (!(await isFile(candidate))) continue;
      if (suffix === ".cmd") return resolveWindowsShim(candidate);
      if (suffix === ".bat") throw new Error(`unsupported Windows batch shim: ${candidate}`);
      return { executable: candidate, prefixArgs: [] };
    }
  }
  throw new Error(`command not found on PATH: ${command}`);
}

function firstLine(value: string): string {
  return value.split(/\r?\n/u, 1)[0]?.trim() ?? "";
}

export async function probeCommand(
  command: string,
  args: readonly string[] = ["--version"],
  timeoutMs = 5_000,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CommandProbe> {
  let resolved: ResolvedCommand;
  try {
    resolved = await resolveCommand(command, environment);
  } catch (error) {
    return {
      command,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return new Promise((resolveProbe) => {
    const child = spawn(resolved.executable, [...resolved.prefixArgs, ...args], {
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: CommandProbe): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProbe(result);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      finish({ command, resolvedCommand: resolved.executable, available: false, error: error.message });
    });
    child.once("close", (code) => {
      const output = firstLine(stdout) || firstLine(stderr);
      if (code === 0) {
        finish({
          command,
          resolvedCommand: resolved.executable,
          available: true,
          ...(output ? { version: output } : {}),
        });
      } else {
        finish({
          command,
          resolvedCommand: resolved.executable,
          available: false,
          error: output || `exited with code ${String(code)}`,
        });
      }
    });

    const timer = setTimeout(() => {
      child.kill();
      finish({
        command,
        resolvedCommand: resolved.executable,
        available: false,
        error: `probe timed out after ${String(timeoutMs)}ms`,
      });
    }, timeoutMs);
    timer.unref();
  });
}
