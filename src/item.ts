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

export function buildItem(p: { connector: string; tool: string; args: Record<string, unknown>; userId: string; data: unknown; executionId: string; now?: Date }): ContextItem {
  const isText = typeof p.data === "string";
  return {
    connector: p.connector,
    tool: p.tool,
    user: "u_" + sha(p.userId).slice(0, 10),
    args: p.args,
    key: itemKey(p.connector, p.tool, p.args),
    fetchedAt: (p.now ?? new Date()).toISOString(),
    executionId: p.executionId,
    contentType: isText ? "text/plain" : "application/json",
    content: redact(isText ? (p.data as string) : JSON.stringify(p.data, null, 1)),
  };
}

function header(i: ContextItem): string {
  return `Scalekit context ${i.key}: ${i.connector}/${i.tool} args=${redact(JSON.stringify(sortKeys(i.args)))} fetched=${i.fetchedAt} user=${i.user} execution=${i.executionId}`;
}

export function memoryText(i: ContextItem): { text: string; overflow: boolean } {
  const h = header(i);
  if (i.content.length <= MAX_INLINE) return { text: `${h}\n${i.content}`, overflow: false };
  return { text: `${h}\nContent is ${i.content.length} characters, stored locally. Read it with: entire scalekit show ${i.key}`, overflow: true };
}
