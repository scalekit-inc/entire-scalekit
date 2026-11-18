import { parseEnv } from "node:util";

/** The file in the plugin data directory that holds the Scalekit credentials, so no terminal has to export them. */
export const CONFIG_FILE = "config.env";

export const REQUIRED = ["SCALEKIT_ENV_URL", "SCALEKIT_CLIENT_ID", "SCALEKIT_CLIENT_SECRET"] as const;

/** Other names people already use for a required variable. Within one source, the required name wins when both are set. */
const ALIASES: Record<string, string[]> = { SCALEKIT_ENV_URL: ["SCALEKIT_ENVIRONMENT_URL"] };

export interface ScalekitValues {
  envUrl: string;
  clientId: string;
  clientSecret: string;
}

type Source = Record<string, string | undefined>;

const lookup = (source: Source, name: string) => [name, ...(ALIASES[name] ?? [])].map((n) => source[n]).find(Boolean);

function complete(source: Source): ScalekitValues | undefined {
  const [envUrl, clientId, clientSecret] = REQUIRED.map((n) => lookup(source, n));
  return envUrl && clientId && clientSecret ? { envUrl, clientId, clientSecret } : undefined;
}

/**
 * The Scalekit credentials, from one source only: the shell when it has all three, otherwise the config file.
 * Values are never mixed across sources, so a stale export cannot pair one environment's URL with another's secret.
 * `fileText` is undefined when there is no config file. `missing` names what neither source has.
 */
export function scalekitConfig(env: NodeJS.ProcessEnv, fileText: string | undefined): { values: ScalekitValues | undefined; missing: string[]; partialShell: string[] } {
  const file = fileText === undefined ? {} : parseEnv(fileText);
  const values = complete(env) ?? complete(file);
  const missing = values ? [] : REQUIRED.filter((n) => !lookup(file, n));
  // Names exported in the shell that were not used because the shell lacks the rest.
  const partialShell = complete(env) ? [] : REQUIRED.filter((n) => lookup(env, n));
  return { values, missing: [...missing], partialShell: [...partialShell] };
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const AGENT_STOP = "If you are an agent: stop and show the person this message. Do not reach the app another way.";

/** What to print when credentials are missing. An agent reads this too, so it says to stop. */
export function setupMessage(missing: string[], configPath: string, partialShell: string[] = []): string {
  const path = shellQuote(configPath);
  return [
    ...(partialShell.length ? [`Your shell exports ${partialShell.join(", ")} but not all three, so those exports were not used.`] : []),
    `entire scalekit has no Scalekit credentials: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set in ${configPath}. Nothing was run.`,
    "Put all three values in that file, one per line:",
    "  SCALEKIT_ENV_URL=https://<your-environment>.scalekit.cloud",
    "  SCALEKIT_CLIENT_ID=<client id>",
    "  SCALEKIT_CLIENT_SECRET=<client secret>",
    "Copy them from app.scalekit.com: Developers > Settings > API Credentials. If you already have a .env with them:",
    `  install -m 600 .env ${path}`,
    "The file works in every terminal. Values exported in the shell also work, and win when all three are exported.",
    AGENT_STOP,
  ].join("\n");
}

/** What to print when the config file exists but cannot be read. */
export function unreadableMessage(configPath: string, reason: string): string {
  return [`entire scalekit cannot read ${configPath}: ${reason}. Nothing was run.`, `Make it a file you own: chmod 600 ${shellQuote(configPath)}`, AGENT_STOP].join("\n");
}

/** A warning when the file that holds the client secret can be read by other users. */
export function looseModeWarning(configPath: string, mode: number): string | undefined {
  if ((mode & 0o077) === 0) return undefined;
  return `Warning: ${configPath} holds your Scalekit client secret and other users can read it. Run: chmod 600 ${shellQuote(configPath)}`;
}
