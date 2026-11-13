import type { ContextItem } from "./item.js";

/** One tool a connector exposes. `readOnly` comes from Scalekit's `read_only_hint`. */
export interface ToolInfo {
  name: string;
  description: string;
  readOnly: boolean;
  inputs: string[];
  inputSchema: unknown;
}

/** One connector configured in this Scalekit environment. */
export interface ConnectionInfo {
  name: string;
  provider: string;
}

/** One entry in Scalekit's connector catalog. */
export interface CatalogEntry {
  identifier: string;
  displayName: string;
  description: string;
}

/** Everything the plugin asks of Scalekit, for the configured user. */
export interface ScalekitPort {
  searchCatalog(words: string): Promise<CatalogEntry[]>;
  listConnections(): Promise<ConnectionInfo[]>;
  /** Names of the connections this user has an active connected account for. */
  readyConnections(): Promise<Set<string>>;
  listTools(provider: string): Promise<ToolInfo[]>;
  createConnection(provider: string, name: string): Promise<ConnectionInfo>;
  authorizationLink(connection: string): Promise<string>;
  execute(connection: string, tool: string, args: Record<string, unknown>): Promise<{ data: unknown; executionId: string }>;
}

/** Everything the plugin asks of Entire Brain. */
export interface BrainPort {
  remember(text: string, path: string): void;
  /** True when this repository syncs memories to a hosted Brain. */
  shared(): boolean;
}

/** Local copies of context items, plus small per-repository flags. */
export interface StorePort {
  save(item: ContextItem): void;
  load(key: string): ContextItem | undefined;
  has(flag: string): boolean;
  set(flag: string): void;
}

export interface Deps {
  scalekit: ScalekitPort;
  brain: BrainPort;
  store: StorePort;
  /** The Scalekit identifier of the user. Hashed before it is saved. */
  userId: string;
  out(line: string): void;
  err(line: string): void;
}
