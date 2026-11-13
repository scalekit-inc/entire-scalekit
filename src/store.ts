import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextItem } from "./item.js";
import type { StorePort } from "./ports.js";

function repositoryId(cwd: string): string {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  const root = top.status === 0 ? top.stdout.trim() : cwd;
  return createHash("sha256").update(root).digest("hex").slice(0, 12);
}

export const dataRoot = (env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()) => env.ENTIRE_PLUGIN_DATA_DIR ?? join(cwd, ".entire-scalekit");

/**
 * Local copies of context items, and small flags.
 * Items are shared across repositories: a key is a hash of the call.
 * Flags are per repository, because Brain memories are per repository.
 * Nothing here is synced, and nothing here holds a credential.
 */
export function fileStore(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): StorePort {
  const root = dataRoot(env, cwd);
  const items = join(root, "items");
  const flags = join(root, "flags", repositoryId(cwd));
  const flagFile = (flag: string) => join(flags, flag.replace(/[^A-Za-z0-9._-]+/g, "_"));

  return {
    save(item: ContextItem) {
      mkdirSync(items, { recursive: true });
      writeFileSync(join(items, `${item.key}.json`), JSON.stringify(item, null, 2));
    },
    load(key: string) {
      if (!/^[0-9a-f]{12}$/.test(key)) return undefined;
      const file = join(items, `${key}.json`);
      return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ContextItem) : undefined;
    },
    has: (flag: string) => existsSync(flagFile(flag)),
    set(flag: string) {
      mkdirSync(flags, { recursive: true });
      writeFileSync(flagFile(flag), "");
    },
  };
}
