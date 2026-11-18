import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { brainAdapter } from "./brain.js";
import { runCli } from "./commands.js";
import { CONFIG_FILE, looseModeWarning, scalekitConfig, setupMessage, unreadableMessage } from "./config.js";
import { connectedAccountIdentifier } from "./identifier.js";
import type { ScalekitPort } from "./ports.js";
import { scalekitAdapter } from "./scalekit.js";
import { dataRoot, fileStore } from "./store.js";

class MissingCredentials extends Error {}

/**
 * The Scalekit client is built on first use, so `show` and `agent-guide` work without the three Scalekit values.
 * The values come from the shell or from config.env in the plugin data directory. Entire passes that directory to
 * every run, so the file works in any terminal without ENTIRE_PLUGIN_ENV.
 */
function lazyScalekit(identifier: string, dataDir: string): ScalekitPort {
  let real: ScalekitPort | undefined;
  const get = () => {
    if (real) return real;
    const configPath = join(dataDir, CONFIG_FILE);
    let fileText: string | undefined;
    if (existsSync(configPath)) {
      try {
        fileText = readFileSync(configPath, "utf8");
      } catch (e) {
        throw new MissingCredentials(unreadableMessage(configPath, e instanceof Error ? e.message : String(e)));
      }
      const warning = looseModeWarning(configPath, statSync(configPath).mode);
      if (warning) console.error(warning);
    }
    const { values, missing, partialShell } = scalekitConfig(process.env, fileText);
    if (!values) throw new MissingCredentials(setupMessage(missing, configPath, partialShell));
    real = scalekitAdapter(values.envUrl, values.clientId, values.clientSecret, identifier, join(dataRoot(), "catalog.json"));
    return real;
  };
  return new Proxy({} as ScalekitPort, { get: (_t, method: keyof ScalekitPort) => (...args: unknown[]) => (get()[method] as (...a: unknown[]) => unknown)(...args) });
}

try {
  const dataDir = process.env.ENTIRE_PLUGIN_DATA_DIR;
  if (!dataDir) throw new MissingCredentials("ENTIRE_PLUGIN_DATA_DIR is not set. Entire sets it when it runs this CLI plugin.");
  const identifier = connectedAccountIdentifier(dataDir);
  process.exitCode = await runCli(process.argv.slice(2), {
    scalekit: lazyScalekit(identifier, dataDir),
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
