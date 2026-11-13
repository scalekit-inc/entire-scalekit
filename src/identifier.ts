import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "identifier";

/** One install keeps one connected account, so the value lives in the plugin data directory, not the repo. */
export function connectedAccountIdentifier(dataDir: string): string {
  const path = join(dataDir, FILE);
  if (existsSync(path)) {
    const saved = readFileSync(path, "utf8").trim();
    if (saved) return saved;
  }
  const created = `usr_${randomBytes(16).toString("hex")}`;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path, `${created}\n`, { mode: 0o600 });
  return created;
}
