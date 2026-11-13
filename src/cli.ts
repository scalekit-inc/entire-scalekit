import { brainAdapter } from "./brain.js";
import { runCli } from "./commands.js";
import { connectedAccountIdentifier } from "./identifier.js";
import type { ScalekitPort } from "./ports.js";
import { scalekitAdapter } from "./scalekit.js";
import { join } from "node:path";
import { dataRoot, fileStore } from "./store.js";

const REQUIRED = ["SCALEKIT_ENV_URL", "SCALEKIT_CLIENT_ID", "SCALEKIT_CLIENT_SECRET"] as const;

class MissingCredentials extends Error {}

/** The Scalekit client is built on first use, so `show` and `agent-guide` work without the three Scalekit values. */
function lazyScalekit(identifier: string): ScalekitPort {
  let real: ScalekitPort | undefined;
  const get = () => {
    if (real) return real;
    const missing = REQUIRED.filter((n) => !process.env[n]);
    if (missing.length)
      throw new MissingCredentials(
        `Missing environment variables: ${missing.join(", ")}.\nSet them in your shell. Entire passes them to a plugin only when ENTIRE_PLUGIN_ENV names them: export ENTIRE_PLUGIN_ENV='SCALEKIT_*'`,
      );
    real = scalekitAdapter(process.env.SCALEKIT_ENV_URL!, process.env.SCALEKIT_CLIENT_ID!, process.env.SCALEKIT_CLIENT_SECRET!, identifier, join(dataRoot(), "catalog.json"));
    return real;
  };
  return new Proxy({} as ScalekitPort, { get: (_t, method: keyof ScalekitPort) => (...args: unknown[]) => (get()[method] as (...a: unknown[]) => unknown)(...args) });
}

try {
  const dataDir = process.env.ENTIRE_PLUGIN_DATA_DIR;
  if (!dataDir) throw new MissingCredentials("ENTIRE_PLUGIN_DATA_DIR is not set. Entire sets it when it runs this CLI plugin.");
  const identifier = connectedAccountIdentifier(dataDir);
  process.exitCode = await runCli(process.argv.slice(2), {
    scalekit: lazyScalekit(identifier),
    brain: brainAdapter(),
    store: fileStore(),
    userId: identifier,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
} catch (e) {
  // Scalekit and Brain failures arrive here. Print the message, not a stack trace.
  console.error(e instanceof MissingCredentials ? e.message : `entire-scalekit: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
