import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const ENV = {
  token: process.env.SCRIBE_API_TOKEN,
  workspace: process.env.ROOK_WORKSPACE,
  conversation: process.env.ROOK_CONVERSATION,
};

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function runDesk(command, sessionId, input = "") {
  const token = requireValue(ENV.token, "SCRIBE_API_TOKEN");
  const cwd = requireValue(ENV.workspace, "ROOK_WORKSPACE");
  const args = [
    "-m",
    "incident_scribe",
    command,
    "--token",
    token,
    "--session-id",
    sessionId,
  ];

  const { code, stdout, stderr } = await new Promise((resolve, reject) => {
    const child = spawn("python3", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });

  let body;
  try {
    body = JSON.parse(stdout);
  } catch {
    throw new Error(`${command} returned invalid JSON${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : ""}`);
  }
  if (code !== 0 || body.ok !== true) {
    const detail = body.message || body.error || stderr.trim().split("\n").at(-1) || `exited ${code}`;
    throw new Error(`${command} failed: ${detail}`);
  }
  return body;
}

async function open() {
  const sessionId = `rook-${randomBytes(12).toString("hex")}`;
  const body = await runDesk("open", sessionId);
  return { conversation: body.session_id };
}

async function execute() {
  const sessionId = requireValue(ENV.conversation, "ROOK_CONVERSATION");
  const goal = await new Promise((resolve) => {
    let text = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => resolve(text));
  });
  const body = await runDesk("execute", sessionId, goal);
  return {
    ...body,
    agent_reply: body.answer,
    conversation: sessionId,
    calls: body.calls,
    usage: body.usage,
  };
}

async function close() {
  const sessionId = requireValue(ENV.conversation, "ROOK_CONVERSATION");
  await runDesk("close", sessionId);
}

async function collect() {
  const sessionId = requireValue(ENV.conversation, "ROOK_CONVERSATION");
  const body = await runDesk("logs", sessionId);
  const calls = body.entries
    .filter((entry) => entry.event === "tool_call")
    .map((entry) => ({ name: entry.tool, arguments: entry.arguments }));
  return { ...body, calls };
}

const PHASES = { open, execute, close, collect };
const fn = PHASES[process.argv[2]];
if (!fn) throw new Error(`unknown phase: ${process.argv[2]}`);
const result = await fn();
if (result) console.log(JSON.stringify(result));
