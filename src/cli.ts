import { brainAdapter } from "./brain.js";
import { runCli } from "./commands.js";
import type { ScalekitPort } from "./ports.js";
import { scalekitAdapter } from "./scalekit.js";
import { join } from "node:path";
import { dataRoot, fileStore } from "./store.js";

const REQUIRED = ["SCALEKIT_ENV_URL", "SCALEKIT_CLIENT_ID", "SCALEKIT_CLIENT_SECRET", "SCALEKIT_IDENTIFIER"] as const;

class MissingCredentials extends Error {}

/** The Scalekit client is built on first use, so `show` and `agent-guide` work without credentials. */
function lazyScalekit(): ScalekitPort {
  let real: ScalekitPort | undefined;
  const get = () => {
    if (real) return real;
    const missing = REQUIRED.filter((n) => !process.env[n]);
    if (missing.length)
      throw new MissingCredentials(
        `Missing environment variables: ${missing.join(", ")}.\nSet them in your shell. Entire passes them to a plugin only when ENTIRE_PLUGIN_ENV names them: export ENTIRE_PLUGIN_ENV='SCALEKIT_*'`,
      );
    real = scalekitAdapter(process.env.SCALEKIT_ENV_URL!, process.env.SCALEKIT_CLIENT_ID!, process.env.SCALEKIT_CLIENT_SECRET!, process.env.SCALEKIT_IDENTIFIER!, join(dataRoot(), "catalog.json"));
    return real;
  };
  return new Proxy({} as ScalekitPort, { get: (_t, method: keyof ScalekitPort) => (...args: unknown[]) => (get()[method] as (...a: unknown[]) => unknown)(...args) });
}

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    scalekit: lazyScalekit(),
    brain: brainAdapter(),
    store: fileStore(),
    userId: process.env.SCALEKIT_IDENTIFIER ?? "",
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
} catch (e) {
  // Scalekit and Brain failures arrive here. Print the message, not a stack trace.
  console.error(e instanceof MissingCredentials ? e.message : `entire-scalekit: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
