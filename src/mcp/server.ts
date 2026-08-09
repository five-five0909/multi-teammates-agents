import { createInterface } from "node:readline";
import { BoundRunService } from "../lifecycle/run-service.js";
import type { AuditDecision, HumanDecision, RoleResult } from "../runtime/core/contracts.js";
import { runForeground } from "../runtime/foreground.js";
import { PACKAGE_VERSION } from "../version.js";

const TOOL_NAMES = [
  "expert_team_start", "expert_team_status", "expert_team_version", "expert_team_compliance",
  "expert_team_next", "expert_team_submit_result", "expert_team_submit_audit", "expert_team_answer",
  "expert_team_resume", "expert_team_cancel", "expert_team_record_host_event", "expert_team_prepare",
  "expert_team_select_mode", "expert_team_qualify", "expert_team_run",
] as const;

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function textResult(value: unknown, isError = false): JsonObject {
  return { content:[{ type:"text", text:typeof value === "string" ? value : JSON.stringify(value) }], structuredContent:value, isError };
}

export class McpServer {
  public constructor(
    private readonly project?: string,
    private readonly sessionId?: string,
    private readonly foreground: typeof runForeground = runForeground,
  ) {}

  public async dispatch(input: unknown): Promise<JsonObject | null> {
    const request = object(input, "request");
    const id = request.id ?? null;
    if (request.method === "notifications/initialized") return null;
    if (request.method === "initialize") return this.result(id, { protocolVersion:"2025-06-18", capabilities:{ tools:{} }, serverInfo:{ name:"expert-team", version:PACKAGE_VERSION } });
    if (request.method === "ping") return this.result(id, {});
    if (request.method === "tools/list") return this.result(id, { tools:TOOL_NAMES.map((name) => ({ name, description:`MTA ${name.slice("expert_team_".length).replaceAll("_", " ")}`, inputSchema:{ type:"object", additionalProperties:true } })) });
    if (request.method !== "tools/call") return this.error(id, -32601, `Method not found: ${String(request.method)}`);
    try {
      const params = object(request.params, "tools/call params");
      if (typeof params.name !== "string" || !TOOL_NAMES.includes(params.name as typeof TOOL_NAMES[number])) return this.error(id, -32601, `Unknown tool: ${String(params.name)}`);
      const args = params.arguments === undefined ? {} : object(params.arguments, "tool arguments");
      return this.result(id, textResult(await this.call(params.name as typeof TOOL_NAMES[number], args)));
    } catch (error) {
      return this.result(id, textResult(error instanceof Error ? error.message : String(error), true));
    }
  }

  private async call(name: typeof TOOL_NAMES[number], args: JsonObject): Promise<unknown> {
    if (name === "expert_team_version") return { package_version:PACKAGE_VERSION, runtime:"typescript", schema_version:1 };
    if (this.project === undefined) throw new Error("workspace_unbound: MCP was started without an explicit project root");
    const service = await BoundRunService.open(this.project, this.sessionId, "mcp");
    const taskId = service.assertTask(args.task_id);
    const repository = service.runtime(args.run_id);
    switch (name) {
      case "expert_team_start": {
        if (typeof args.run_id !== "string") throw new Error("run_id is required");
        if (object(args.qualification_receipt, "qualification_receipt").approved !== true) throw new Error("qualification_receipt.approved must be true");
        return service.start(repository.runId, object(args.contract, "contract"), args.work_items, {
          ...(typeof args.max_rounds === "number" ? { maxRounds:args.max_rounds } : {}),
          ...(typeof args.retry_limit === "number" ? { retryLimit:args.retry_limit } : {}),
        });
      }
      case "expert_team_status": return repository.load();
      case "expert_team_resume": {
        return service.resume(repository.runId);
      }
      case "expert_team_submit_result": return repository.submitResult(object(args.result, "result") as RoleResult);
      case "expert_team_submit_audit": return repository.submitAudit(object(args.audit, "audit") as AuditDecision);
      case "expert_team_answer": return repository.answer(object(args.decision, "decision") as HumanDecision);
      case "expert_team_cancel": return repository.transition("run.cancelled", { reason:"cancelled through MCP" }, "mcp-cancel");
      case "expert_team_compliance": {
        const snapshot = await repository.load();
        return { task_id:taskId, run_id:snapshot.run_id, compliant:snapshot.pending_gate === null, checks:Array.isArray(args.checks) ? args.checks : [] };
      }
      case "expert_team_next":
      case "expert_team_record_host_event":
      case "expert_team_prepare":
      case "expert_team_select_mode":
      case "expert_team_qualify":
        throw new Error(`${name} is preserved for compatibility but requires the foreground supervisor command`);
      case "expert_team_run": return this.foreground(service, repository.runId, args.config);
    }
  }

  private result(id: unknown, result: unknown): JsonObject { return { jsonrpc:"2.0", id, result }; }
  private error(id: unknown, code: number, message: string): JsonObject { return { jsonrpc:"2.0", id, error:{ code, message } }; }
}

export async function serveMcp(project?: string, sessionId?: string): Promise<void> {
  const server = new McpServer(project, sessionId);
  const lines = createInterface({ input:process.stdin, crlfDelay:Infinity });
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    let response: JsonObject | null;
    try { response = await server.dispatch(JSON.parse(line) as unknown); }
    catch { response = { jsonrpc:"2.0", id:null, error:{ code:-32700, message:"Parse error" } }; }
    if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
