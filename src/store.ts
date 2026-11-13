import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ContextItem } from "./item.js";

// Local copy of each item. Gitignored, never synced. Holds no credentials.
const dir = () => join(process.env.ENTIRE_PLUGIN_DATA_DIR ?? join(process.cwd(), ".entire-scalekit"), "items");

export function saveItem(i: ContextItem): string {
  mkdirSync(dir(), { recursive: true });
  const f = join(dir(), `${i.key}.json`);
  writeFileSync(f, JSON.stringify(i, null, 2));
  return f;
}

export function loadItem(key: string): ContextItem | undefined {
  if (!/^[0-9a-f]{12}$/.test(key)) return undefined;
  const f = join(dir(), `${key}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ContextItem) : undefined;
}
