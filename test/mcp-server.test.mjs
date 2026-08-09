import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { McpServer } from "../dist/mcp/server.js";
import { TaskRepository } from "../dist/lifecycle/task-repository.js";

async function preparedProject() {
  const project = await mkdtemp(join(tmpdir(), "mta-mcp-"));
  await mkdir(join(project, ".git"));
  const tasks = await TaskRepository.open(project);
  const created = await tasks.create("MCP task", { slug:"mcp-task" });
  const taskDir = join(project, ...created.path.split("/"));
  for (const name of ["prd.md", "design.md", "implement.md"]) {
    await writeFile(join(taskDir, name), `# ${name}\n\nReviewed implementation contract with enough concrete content for lifecycle validation.\n`);
  }
  await tasks.start("mcp-task", "session-mcp", "codex");
  return project;
}

async function call(server, id, name, args) {
  const response = await server.dispatch({ jsonrpc:"2.0", id, method:"tools/call", params:{ name, arguments:args } });
  return response.result;
}

test("TypeScript MCP preserves tool names and status/resume use the bound store", async () => {
  const project = await preparedProject();
  try {
    const server = new McpServer(project, "session-mcp");
    const listed = await server.dispatch({ jsonrpc:"2.0", id:1, method:"tools/list" });
    assert.equal(listed.result.tools.length, 15);
    assert.ok(listed.result.tools.some((tool) => tool.name === "expert_team_resume"));
    const contract = { schema_version:1, goal:"Ship MCP", constraints:[], deliverables:["server"], acceptance_criteria:["status works"] };
    const workItems = [{ schema_version:1, id:"item-1", objective:"Implement", role:"executor", mode:"write", required:true, depends_on:[], ownership:["src/mcp"], evidence_required:["tests"], executor_id:null, attempt:0, status:"pending" }];
    const started = await call(server, 2, "expert_team_start", { task_id:"mcp-task", run_id:"run-1", contract, work_items:workItems, qualification_receipt:{ approved:true } });
    assert.equal(started.isError, false);
    const status = await call(server, 3, "expert_team_status", { task_id:"mcp-task", run_id:"run-1" });
    assert.equal(status.structuredContent.state, "initialized");
    const resume = await call(server, 4, "expert_team_resume", { task_id:"mcp-task", run_id:"run-1" });
    assert.deepEqual(resume.structuredContent.work_items["item-1"], { status:"pending", attempt:0 });
  } finally {
    await rm(project, { recursive:true, force:true });
  }
});

test("MCP fails closed without a unique session binding", async () => {
  const project = await mkdtemp(join(tmpdir(), "mta-mcp-unbound-"));
  await mkdir(join(project, ".git"));
  try {
    const result = await call(new McpServer(project), 1, "expert_team_status", { task_id:"missing", run_id:"run" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /workspace_unbound/u);
  } finally {
    await rm(project, { recursive:true, force:true });
  }
});

test("expert_team_run is the MCP foreground entry and forwards the shared bound service", async () => {
  const project = await preparedProject();
  try {
    let received;
    const server = new McpServer(project, "session-mcp", async (service, runId, config) => {
      received = { taskId:service.taskId, runId, config };
      return { snapshot:{ state:"completed" }, episodeIds:["episode-1"] };
    });
    const result = await call(server, 1, "expert_team_run", { task_id:"mcp-task", run_id:"run-1", config:{ roles:{} } });
    assert.equal(result.isError, false);
    assert.deepEqual(received, { taskId:"mcp-task", runId:"run-1", config:{ roles:{} } });
    assert.deepEqual(result.structuredContent.episodeIds, ["episode-1"]);
  } finally {
    await rm(project, { recursive:true, force:true });
  }
});
