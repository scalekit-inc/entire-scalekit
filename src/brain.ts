import { spawnSync } from "node:child_process";
import type { BrainPort } from "./ports.js";

/** Entire Brain, through the `entire brain` command. */
export function brainAdapter(env: NodeJS.ProcessEnv = process.env): BrainPort {
  return {
    remember(text, path) {
      // Always pass --path: without it Brain may call a model to classify the memory.
      const out = spawnSync("entire", ["brain", "remember", text, "--path", path, "--kind", env.ENTIRE_SCALEKIT_KIND ?? "convention"], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
      if (out.status !== 0) throw new Error(`entire brain remember failed: ${(out.stderr ?? "").trim() || out.error?.message || "unknown error"}`);
    },

    shared() {
      if (env.ENTIRE_BRAIN_NO_EGRESS === "1") return false;
      const out = spawnSync("entire", ["brain", "status", "--json"], { encoding: "utf8" });
      if (out.status !== 0) return false;
      try {
        const hosted = (JSON.parse(out.stdout) as { hosted?: { state?: string; no_egress?: boolean } }).hosted;
        return !!hosted && !hosted.no_egress && !!hosted.state && hosted.state !== "disconnected";
      } catch {
        return false;
      }
    },
  };
}
