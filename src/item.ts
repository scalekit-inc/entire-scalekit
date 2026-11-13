import { createHash } from "node:crypto";

export const MAX_INLINE = 8000;

export interface ContextItem {
  connector: string;
  tool: string;
  user: string;
  args: Record<string, unknown>;
  key: string;
  fetchedAt: string;
  executionId: string;
  contentType: string;
  content: string;
  /** True when a write tool produced this item. A write is never repeated. */
  write?: boolean;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
  return v;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function itemKey(connector: string, tool: string, args: Record<string, unknown>): string {
  return sha(JSON.stringify([connector, tool, sortKeys(args)])).slice(0, 12);
}

/** Each execution of a write tool is its own item, so the key includes the execution. */
export function writeKey(connector: string, tool: string, args: Record<string, unknown>, executionId: string): string {
  return sha(JSON.stringify(["write", connector, tool, sortKeys(args), executionId])).slice(0, 12);
}

/** Some apps report a failure inside a successful response. Returns its message, if any. */
export function appError(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const d = data as Record<string, unknown>;
  if (d.ok === false) return typeof d.error === "string" && d.error ? d.error : "the app reported a failure";
  if (Array.isArray(d.errors) && d.errors.length) {
    const first = d.errors[0] as { message?: unknown } | string;
    return typeof first === "string" ? first : typeof first?.message === "string" ? first.message : "the app reported an error";
  }
  return undefined;
}

const seg = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";

export function brainPath(connector: string, tool: string): string {
  return `project.${seg(connector)}.${seg(tool)}`;
}

export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/("?(?:api[_-]?key|secret|token|password|authorization|client_secret)"?\s*[:=]\s*)"[^"]{6,}"/gi, '$1"[redacted]"')
    .replace(/\b(?:sk|xox[abprs]|ghp|gho|lin_api)[-_][A-Za-z0-9_-]{10,}/g, "[redacted]");
}

export function buildItem(p: { connector: string; tool: string; args: Record<string, unknown>; userId: string; data: unknown; executionId: string; now?: Date; write?: boolean }): ContextItem {
  const isText = typeof p.data === "string";
  const now = p.now ?? new Date();
  return {
    ...(p.write ? { write: true } : {}),
    connector: p.connector,
    tool: p.tool,
    user: "u_" + sha(p.userId).slice(0, 10),
    args: p.args,
    key: p.write ? writeKey(p.connector, p.tool, p.args, p.executionId || now.toISOString()) : itemKey(p.connector, p.tool, p.args),
    fetchedAt: now.toISOString(),
    executionId: p.executionId,
    contentType: isText ? "text/plain" : "application/json",
    content: redact(isText ? (p.data as string) : JSON.stringify(p.data, null, 1)),
  };
}

function header(i: ContextItem): string {
  return `Scalekit context ${i.key}: ${i.connector}/${i.tool}${i.write ? " (write, do not repeat)" : ""} args=${redact(JSON.stringify(sortKeys(i.args)))} fetched=${i.fetchedAt} user=${i.user} execution=${i.executionId}`;
}

export function memoryText(i: ContextItem): { text: string; overflow: boolean } {
  const h = header(i);
  if (i.content.length <= MAX_INLINE) return { text: `${h}\n${i.content}`, overflow: false };
  return { text: `${h}\nContent is ${i.content.length} characters, stored locally. Read it with: entire scalekit show ${i.key}`, overflow: true };
}

export interface Route {
  connection: string;
  tool: string;
  description: string;
  readOnly: boolean;
  inputs: string[];
}

export function routePath(connection: string, tool: string): string {
  return `workflow.${seg(connection)}.${seg(tool)}`;
}

/** A route memory: which connection and tool answer a kind of request. It holds no content. */
export function routeText(r: Route): string {
  const verb = r.readOnly ? "fetch" : "run";
  const inputs = r.inputs.length ? r.inputs.join(", ") : "none";
  return `Scalekit route: ${(r.description || r.tool).replace(/[.\s]+$/, "")}. Run: entire scalekit ${verb} ${r.connection} ${r.tool} --args '<json>'. Inputs: ${inputs}. ${r.readOnly ? "Read tool: recall from Brain first." : "Write tool: it changes the app, so never repeat it without being asked."}`;
}
