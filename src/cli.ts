import { spawnSync } from "node:child_process";
import { ScalekitClient } from "@scalekit-sdk/node";
import { brainPath, buildItem, memoryText, type ContextItem } from "./item.js";
import { loadItem, saveItem } from "./store.js";

const REQUIRED = ["SCALEKIT_ENV_URL", "SCALEKIT_CLIENT_ID", "SCALEKIT_CLIENT_SECRET", "SCALEKIT_IDENTIFIER"];
const usage = `entire scalekit fetch <connector> <tool> [--args '<json>']
entire scalekit show <key>
entire scalekit refresh <key>`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function client() {
  const missing = REQUIRED.filter((n) => !process.env[n]);
  if (missing.length)
    fail(`Missing environment variables: ${missing.join(", ")}.\nEntire only passes variables listed in ENTIRE_PLUGIN_ENV. Add them there.`);
  return new ScalekitClient(process.env.SCALEKIT_ENV_URL!, process.env.SCALEKIT_CLIENT_ID!, process.env.SCALEKIT_CLIENT_SECRET!);
}

async function fetchItem(connector: string, tool: string, args: Record<string, unknown>): Promise<ContextItem> {
  const identifier = process.env.SCALEKIT_IDENTIFIER!;
  const res = await client().actions.executeTool({ toolName: tool, toolInput: args, connector, identifier });
  const r = res as unknown as { data?: unknown; executionId?: string };
  return buildItem({ connector, tool, args, userId: identifier, data: r.data ?? {}, executionId: r.executionId ?? "" });
}

function remember(i: ContextItem) {
  const { text, overflow } = memoryText(i);
  const out = spawnSync("entire", ["brain", "remember", text, "--path", brainPath(i.connector, i.tool), "--kind", process.env.ENTIRE_SCALEKIT_KIND ?? "convention"], { stdio: "inherit" });
  if (out.status !== 0) fail("entire brain remember failed.");
  console.error(`Saved ${i.key}${overflow ? " (large: local file holds the content)" : ""}.`);
  console.error("Note: if this repo runs `entire brain connect`, this memory syncs to the hosted repo.");
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "fetch") {
  const [connector, tool] = rest;
  if (!connector || !tool) fail(usage);
  const a = rest.indexOf("--args");
  let args: Record<string, unknown> = {};
  try { args = a >= 0 ? JSON.parse(rest[a + 1] ?? "") : {}; } catch { fail("--args must be valid JSON."); }
  const item = await fetchItem(connector, tool, args);
  saveItem(item);
  remember(item);
} else if (cmd === "show") {
  const item = rest[0] ? loadItem(rest[0]) : undefined;
  if (!item) fail("No saved item for that key.");
  console.log(`${item.connector}/${item.tool} fetched ${item.fetchedAt}\n${item.content}`);
} else if (cmd === "refresh") {
  const old = rest[0] ? loadItem(rest[0]) : undefined;
  if (!old) fail("No saved item for that key.");
  const item = await fetchItem(old.connector, old.tool, old.args);
  saveItem(item);
  remember(item);
} else fail(usage);
