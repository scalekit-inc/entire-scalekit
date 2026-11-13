import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function run(cwd: string, dataDir: string, args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { PATH: process.env.PATH ?? "", ENTIRE_PLUGIN_DATA_DIR: dataDir },
    encoding: "utf8",
  });
}

it("saves one connected-account identifier and reuses it on the next run", () => {
  const cwd = mkdtempSync(join(tmpdir(), "entire-scalekit-cwd-"));
  const dataDir = mkdtempSync(join(tmpdir(), "entire-scalekit-data-"));

  const first = run(cwd, dataDir, ["agent-guide"]);
  expect(first.status).toBe(0);
  const saved = readFileSync(join(dataDir, "identifier"), "utf8").trim();
  expect(saved).toMatch(/^usr_[a-z0-9]{20,}$/);
  expect(statSync(join(dataDir, "identifier")).mode & 0o777).toBe(0o600);

  const second = run(cwd, dataDir, ["agent-guide"]);
  expect(second.status).toBe(0);
  expect(readFileSync(join(dataDir, "identifier"), "utf8").trim()).toBe(saved);
});

it("does not take the connected-account identifier from a dotenv file", () => {
  const cwd = mkdtempSync(join(tmpdir(), "entire-scalekit-cwd-"));
  const dataDir = mkdtempSync(join(tmpdir(), "entire-scalekit-data-"));
  writeFileSync(join(cwd, ".env.entire"), "SCALEKIT_IDENTIFIER=person@example.com\n", "utf8");
  writeFileSync(join(cwd, ".env"), "SCALEKIT_IDENTIFIER=other@example.com\n", "utf8");

  const result = run(cwd, dataDir, ["agent-guide"]);
  expect(result.status).toBe(0);
  const saved = readFileSync(join(dataDir, "identifier"), "utf8").trim();
  expect(saved).toMatch(/^usr_[a-z0-9]{20,}$/);
  expect(saved).not.toContain("@");
});

it("asks for the three Scalekit values and not for a connected-account identifier", () => {
  const cwd = mkdtempSync(join(tmpdir(), "entire-scalekit-cwd-"));
  const dataDir = mkdtempSync(join(tmpdir(), "entire-scalekit-data-"));
  const result = run(cwd, dataDir, ["connect", "linear"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("SCALEKIT_ENV_URL");
  expect(result.stderr).toContain("SCALEKIT_CLIENT_ID");
  expect(result.stderr).toContain("SCALEKIT_CLIENT_SECRET");
  expect(result.stderr).not.toContain("SCALEKIT_IDENTIFIER");
});
