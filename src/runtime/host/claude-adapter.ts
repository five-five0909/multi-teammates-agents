import type { EpisodeRequest } from "../supervisor/host-adapter.js";
import { CliHostAdapter, type CliAdapterOptions } from "./cli-adapter.js";

export class ClaudeHostAdapter extends CliHostAdapter {
  public constructor(options: CliAdapterOptions = {}) {
    super("claude", options);
  }

  protected override buildArgs(request: EpisodeRequest): readonly string[] {
    return [
      "--print", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
      "--permission-mode", request.readOnly ? "plan" : "acceptEdits",
      ...(request.model === undefined ? [] : ["--model", request.model]),
    ];
  }
}
