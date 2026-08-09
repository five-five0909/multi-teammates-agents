import type { EpisodeRequest } from "../supervisor/host-adapter.js";
import { CliHostAdapter, type CliAdapterOptions } from "./cli-adapter.js";

export class CodexHostAdapter extends CliHostAdapter {
  public constructor(options: CliAdapterOptions = {}) {
    super("codex", options);
  }

  protected override buildArgs(request: EpisodeRequest): readonly string[] {
    return [
      "exec", "--json", "--ephemeral", "--color", "never", "--cd", request.workspace,
      "--sandbox", request.readOnly ? "read-only" : "workspace-write",
      ...(request.model === undefined ? [] : ["--model", request.model]),
      "-",
    ];
  }
}
