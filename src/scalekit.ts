import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ConnectorStatus, ScalekitClient } from "@scalekit-sdk/node";
import type { CatalogEntry, ConnectionInfo, ScalekitPort, ToolInfo } from "./ports.js";

const CATALOG_RESULTS = 20;
const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// The connected-accounts listing rejects larger pages.
const ACCOUNTS_PAGE = 30;

type Json = Record<string, unknown>;

function toToolInfo(definition: Json | undefined): ToolInfo | undefined {
  if (!definition || typeof definition.name !== "string") return undefined;
  const schema = (definition.input_schema ?? {}) as Json;
  const annotations = (definition.annotations ?? {}) as Json;
  return {
    name: definition.name,
    description: typeof definition.description === "string" ? definition.description.split("\n")[0] : "",
    // Only an explicit `true` counts as read-only. A tool without the hint is treated as a write.
    readOnly: annotations.read_only_hint === true,
    inputs: Object.keys((schema.properties ?? {}) as Json),
    inputSchema: schema,
  };
}

/** The Scalekit SDK, for one environment and one user. */
export function scalekitAdapter(envUrl: string, clientId: string, clientSecret: string, identifier: string, catalogCacheFile?: string): ScalekitPort {
  const actions = new ScalekitClient(envUrl, clientId, clientSecret).actions;

  /** The catalog has several hundred connectors and reads slowly, so keep a public copy for a day. */
  async function catalog(): Promise<(CatalogEntry & { categories: string[] })[]> {
    // A hash, not the environment URL: the cache file holds public catalog text only.
    const envMark = createHash("sha256").update(envUrl).digest("hex").slice(0, 16);
    if (catalogCacheFile && existsSync(catalogCacheFile)) {
      try {
        const cached = JSON.parse(readFileSync(catalogCacheFile, "utf8")) as { env?: string; at: number; entries: (CatalogEntry & { categories: string[] })[] };
        if (cached.env === envMark && Date.now() - cached.at < CATALOG_MAX_AGE_MS) return cached.entries;
      } catch {
        /* a damaged cache is read again below */
      }
    }
    const entries: (CatalogEntry & { categories: string[] })[] = [];
    let pageToken: string | undefined;
    do {
      const page = await actions.providers.listProviders({ pageSize: 100, ...(pageToken ? { pageToken } : {}) });
      for (const p of page.providers) entries.push({ identifier: p.identifier, displayName: p.displayName, description: p.description, categories: p.categories ?? [] });
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);
    if (catalogCacheFile) {
      mkdirSync(dirname(catalogCacheFile), { recursive: true });
      writeFileSync(catalogCacheFile, JSON.stringify({ env: envMark, at: Date.now(), entries }));
    }
    return entries;
  }

  return {
    async searchCatalog(words) {
      const wanted = words.toLowerCase().split(/\s+/).filter(Boolean);
      const found = (await catalog()).filter((c) => {
        const text = `${c.identifier} ${c.displayName} ${c.description} ${c.categories.join(" ")}`.toLowerCase();
        return wanted.every((w) => text.includes(w));
      });
      // An exact identifier or name match first, then the rest in catalog order.
      const exact = (c: CatalogEntry) => (wanted.includes(c.identifier.toLowerCase()) || c.displayName.toLowerCase() === words.toLowerCase() ? 0 : 1);
      return found
        .sort((x, y) => exact(x) - exact(y))
        .slice(0, CATALOG_RESULTS)
        .map(({ identifier, displayName, description }) => ({ identifier, displayName, description }));
    },

    async listConnections() {
      const found: ConnectionInfo[] = [];
      let pageToken: string | undefined;
      do {
        const page = await actions.listAppConnections({ pageSize: 100, ...(pageToken ? { pageToken } : {}) });
        for (const c of page.connections) found.push({ name: c.connectionName, provider: c.provider });
        pageToken = page.nextPageToken || undefined;
      } while (pageToken);
      return found;
    },

    async readyConnections() {
      const ready = new Set<string>();
      let pageToken: string | undefined;
      do {
        const page = await actions.listConnectedAccounts({ identifier, pageSize: ACCOUNTS_PAGE, ...(pageToken ? { pageToken } : {}) });
        for (const a of page.connectedAccounts) if (a.status === ConnectorStatus.ACTIVE) ready.add(a.connector);
        pageToken = page.nextPageToken || undefined;
      } while (pageToken);
      return ready;
    },

    async listTools(provider) {
      const found: ToolInfo[] = [];
      let pageToken: string | undefined;
      do {
        const page = await actions.listTools({ provider, pageSize: 100, ...(pageToken ? { pageToken } : {}) });
        for (const t of page.tools) {
          const info = toToolInfo(t.definition as Json | undefined);
          if (info) found.push(info);
        }
        pageToken = page.nextPageToken || undefined;
      } while (pageToken);
      return found;
    },

    async createConnection(provider, name) {
      const c = await actions.createConnection({ provider, connectionName: name });
      return { name: c.connectionName ?? name, provider: c.provider };
    },

    async authorizationLink(connection) {
      return (await actions.getAuthorizationLink({ connectionName: connection, identifier })).link;
    },

    async execute(connection, tool, args) {
      const res = (await actions.executeTool({ toolName: tool, toolInput: args, connector: connection, identifier })) as unknown as { data?: unknown; executionId?: string };
      return { data: res.data ?? {}, executionId: res.executionId ?? "" };
    },
  };
}
