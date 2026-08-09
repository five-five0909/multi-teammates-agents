import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const hostIndex = process.argv.indexOf("--fake-host");
const host = hostIndex === -1 ? "codex" : process.argv[hostIndex + 1];
let input = "";
for await (const chunk of process.stdin) input += chunk;
let request;
try { request = JSON.parse(input); } catch { request = { scenario:"supervisor", output:input }; }
const scenario = request.scenario ?? "normal";

function line(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function final(output) {
  if (host === "codex") line({ type:"item.completed", item:{ type:"agent_message", id:`message-${process.pid}`, text:output } });
  else line({ type:"result", subtype:"success", session_id:`session-${process.pid}`, is_error:false, result:output });
}

function trailingJson(marker) {
  return JSON.parse(input.split(marker).at(-1));
}

if (scenario === "normal") {
  process.stdout.write("non-json startup noise\n");
  const started = JSON.stringify(host === "codex"
    ? { type:"thread.started", thread_id:`thread-${process.pid}` }
    : { type:"system", subtype:"init", session_id:`session-${process.pid}` });
  process.stdout.write(started.slice(0, Math.floor(started.length / 2)));
  await delay(10);
  process.stdout.write(`${started.slice(Math.floor(started.length / 2))}\n`);
  final(request.output ?? `ok-${host}`);
} else if (scenario === "permission") {
  line(host === "codex"
    ? { type:"turn.failed", error:"approval required before tool execution" }
    : { type:"result", subtype:"permission_denied", is_error:true, result:"permission denied by user" });
  process.exitCode = 1;
} else if (scenario === "nonzero") {
  process.stderr.write("host failed\n");
  process.exitCode = 7;
} else if (scenario === "long") {
  final("x".repeat(200_000));
} else if (scenario === "sleep") {
  await delay(30_000);
  final("late");
} else if (scenario === "child") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { shell:false, stdio:"ignore" });
  line({ type:"test.child.started", id:String(child.pid) });
  await delay(30_000);
} else if (scenario === "supervisor") {
  if (input.includes("Authoritative compact state:\n")) {
    const state = trailingJson("Authoritative compact state:\n");
    const ready = state.unresolved_work.find((item) => item.depends_on.every((id) => state.verified_progress[id] !== undefined));
    final(JSON.stringify(ready
      ? { schema_version:1, action:"execute", work_item_ids:[ready.id], message:"fake execution" }
      : { schema_version:1, action:"propose_complete", work_item_ids:[], message:"fake complete" }));
  } else if (input.includes("Authoritative assignment:\n")) {
    const payload = trailingJson("Authoritative assignment:\n");
    final(JSON.stringify({ schema_version:1, work_item_id:payload.work_item.id, attempt:payload.work_item.attempt, executor_id:payload.executor_id, summary:"fake done", artifacts:[], evidence:["fake evidence"], checks:["fake check"], risks:[], failure:null }));
  } else if (input.includes("Authoritative audit input:\n")) {
    const payload = trailingJson("Authoritative audit input:\n");
    final(JSON.stringify({ schema_version:1, work_item_id:payload.work_item.id, attempt:payload.executor_result.attempt, auditor_id:payload.auditor_id, executor_id:payload.executor_result.executor_id, status:"accepted", integrity:"clean", contract_alignment:"aligned", evidence:["fake audit"], findings:[], required_rework:[] }));
  } else {
    process.stderr.write("unrecognized supervisor prompt\n");
    process.exitCode = 3;
  }
} else {
  process.stderr.write(`unknown scenario: ${String(scenario)}\n`);
  process.exitCode = 2;
}
