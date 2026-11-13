import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_GUIDE, runCli } from "../src/commands.js";
import type { ContextItem } from "../src/item.js";
import type { CatalogEntry, ConnectionInfo, Deps, ToolInfo } from "../src/ports.js";

const tool = (name: string, readOnly: boolean, description = name, inputs: string[] = ["issueId"]): ToolInfo => ({ name, description, readOnly, inputs, inputSchema: { type: "object", properties: Object.fromEntries(inputs.map((i) => [i, { type: "string" }])), required: inputs } });

interface World {
  catalog: CatalogEntry[];
  connections: ConnectionInfo[];
  ready: string[];
  tools: Record<string, ToolInfo[]>;
  shared: boolean;
  respond: (connection: string, tool: string, args: Record<string, unknown>) => unknown;
}

function setup(overrides: Partial<World> = {}) {
  const world: World = {
    catalog: [
      { identifier: "LINEAR", displayName: "Linear", description: "Issue tracking for product teams" },
      { identifier: "SLACK", displayName: "Slack", description: "Team chat" },
      { identifier: "NOTION", displayName: "Notion", description: "Docs and wikis" },
    ],
    connections: [{ name: "linear", provider: "LINEAR" }, { name: "slack", provider: "SLACK" }],
    ready: ["linear"],
    tools: {
      LINEAR: [tool("linear_issue_get", true, "Get a Linear issue by ID"), tool("linear_issue_create", false, "Create a Linear issue", ["title", "teamId"]), tool("linear_teams_list", true, "List teams", [])],
      SLACK: [tool("slack_reply_in_thread", false, "Reply in a Slack thread", ["channel", "text"])],
    },
    shared: false,
    respond: (_c, t) => ({ tool: t, title: "List in Entire" }),
    ...overrides,
  };
  const executed: { connection: string; tool: string; args: Record<string, unknown> }[] = [];
  const remembered: { text: string; path: string }[] = [];
  const created: ConnectionInfo[] = [];
  const items = new Map<string, ContextItem>();
  const flags = new Set<string>();
  const out: string[] = [];
  const err: string[] = [];
  let n = 0;
  const deps: Deps = {
    userId: "user@example.com",
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    scalekit: {
      searchCatalog: async (words) => world.catalog.filter((c) => `${c.identifier} ${c.displayName} ${c.description}`.toLowerCase().includes(words.toLowerCase())),
      listConnections: async () => [...world.connections],
      readyConnections: async () => new Set(world.ready),
      listTools: async (provider) => world.tools[provider] ?? [],
      createConnection: async (provider, name) => { const c = { name, provider }; world.connections.push(c); created.push(c); return c; },
      authorizationLink: async (connection) => `https://example.test/magicLink/${connection}`,
      execute: async (connection, t, args) => { executed.push({ connection, tool: t, args }); return { data: world.respond(connection, t, args), executionId: `ex_${++n}` }; },
    },
    brain: { remember: (text, path) => { remembered.push({ text, path }); }, shared: () => world.shared },
    store: { save: (i) => { items.set(i.key, i); }, load: (k) => items.get(k), has: (f) => flags.has(f), set: (f) => { flags.add(f); } },
  };
  const run = (...argv: string[]) => runCli(argv, deps);
  const contextMemories = () => remembered.filter((m) => m.path.startsWith("project."));
  const routeMemories = () => remembered.filter((m) => m.path.startsWith("workflow."));
  return { world, run, executed, remembered, created, items, out, err, contextMemories, routeMemories };
}

describe("fetch", () => {
  it("runs a read tool and saves the response as a Brain memory", async () => {
    const t = setup();
    expect(await t.run("fetch", "linear", "linear_issue_get", "--args", '{"issueId":"DX-42"}')).toBe(0);
    expect(t.executed).toEqual([{ connection: "linear", tool: "linear_issue_get", args: { issueId: "DX-42" } }]);
    expect(t.contextMemories()).toHaveLength(1);
    expect(t.contextMemories()[0].path).toBe("project.linear.linear_issue_get");
    expect(t.contextMemories()[0].text).toContain("List in Entire");
    expect(t.items.size).toBe(1);
  });
  it("refuses a write tool without calling the app", async () => {
    const t = setup();
    expect(await t.run("fetch", "linear", "linear_issue_create", "--args", '{"title":"x","teamId":"t"}')).toBe(1);
    expect(t.executed).toHaveLength(0);
    expect(t.err.join("\n")).toContain("entire scalekit run");
  });
  it("explains an unknown connection", async () => {
    const t = setup();
    expect(await t.run("fetch", "jira", "jira_issue_get")).toBe(1);
    expect(t.err.join("\n")).toContain("search connectors");
    expect(t.executed).toHaveLength(0);
  });
  it("explains an unknown tool", async () => {
    const t = setup();
    expect(await t.run("fetch", "linear", "linear_nope")).toBe(1);
    expect(t.err.join("\n")).toContain("search tools linear");
  });
  it("rejects arguments that are not JSON", async () => {
    const t = setup();
    expect(await t.run("fetch", "linear", "linear_issue_get", "--args", "{nope")).toBe(1);
    expect(t.executed).toHaveLength(0);
  });
  it("does not save an error that the app reports inside a successful response", async () => {
    const t = setup({ respond: () => ({ ok: false, error: "missing_scope" }) });
    expect(await t.run("fetch", "linear", "linear_issue_get", "--args", '{"issueId":"DX-42"}')).toBe(1);
    expect(t.remembered).toHaveLength(0);
    expect(t.items.size).toBe(0);
    expect(t.err.join("\n")).toContain("missing_scope");
  });
});

describe("run", () => {
  it("runs a write tool and saves the response marked as a write", async () => {
    const t = setup();
    expect(await t.run("run", "linear", "linear_issue_create", "--args", '{"title":"x","teamId":"t"}')).toBe(0);
    expect(t.executed).toHaveLength(1);
    expect([...t.items.values()][0].write).toBe(true);
    expect(t.contextMemories()[0].text).toContain("write, do not repeat");
  });
  it("keeps two runs of the same write as two items", async () => {
    const t = setup();
    await t.run("run", "linear", "linear_issue_create", "--args", '{"title":"x","teamId":"t"}');
    await t.run("run", "linear", "linear_issue_create", "--args", '{"title":"x","teamId":"t"}');
    expect(t.items.size).toBe(2);
  });
  it("treats a read tool like fetch does", async () => {
    const t = setup();
    expect(await t.run("run", "linear", "linear_issue_get", "--args", '{"issueId":"DX-42"}')).toBe(0);
    expect([...t.items.values()][0].write).toBeUndefined();
  });
});

describe("refresh", () => {
  it("runs a read tool again with the saved arguments", async () => {
    const t = setup();
    await t.run("fetch", "linear", "linear_issue_get", "--args", '{"issueId":"DX-42"}');
    const key = [...t.items.keys()][0];
    expect(await t.run("refresh", key)).toBe(0);
    expect(t.executed).toHaveLength(2);
    expect(t.executed[1].args).toEqual({ issueId: "DX-42" });
  });
  it("refuses an item that came from a write", async () => {
    const t = setup();
    await t.run("run", "linear", "linear_issue_create", "--args", '{"title":"x","teamId":"t"}');
    const key = [...t.items.keys()][0];
    expect(await t.run("refresh", key)).toBe(1);
    expect(t.executed).toHaveLength(1);
    expect(t.err.join("\n")).toContain("write");
  });
  it("fails for a key that was never saved", async () => {
    const t = setup();
    expect(await t.run("refresh", "000000000000")).toBe(1);
  });
});

describe("show", () => {
  it("prints the saved content", async () => {
    const t = setup();
    await t.run("fetch", "linear", "linear_issue_get", "--args", '{"issueId":"DX-42"}');
    expect(await t.run("show", [...t.items.keys()][0])).toBe(0);
    expect(t.out.join("\n")).toContain("List in Entire");
  });
  it("fails for an unknown key", async () => {
    const t = setup();
    expect(await t.run("show", "nope")).toBe(1);
  });
});

describe("route memory", () => {
  it("is written once per connection and tool", async () => {
    const t = setup();
    await t.run("fetch", "linear", "linear_issue_get", "--args", '{"issueId":"DX-42"}');
    await t.run("fetch", "linear", "linear_issue_get", "--args", '{"issueId":"DX-43"}');
    await t.run("fetch", "linear", "linear_teams_list");
    expect(t.routeMemories()).toHaveLength(2);
    expect(t.routeMemories()[0].text).toContain("entire scalekit fetch linear linear_issue_get");
    expect(t.routeMemories()[0].text).not.toContain("List in Entire");
  });
  it("is not written when the tool fails", async () => {
    const t = setup({ respond: () => ({ errors: [{ message: "Entity not found" }] }) });
    await t.run("fetch", "linear", "linear_issue_get", "--args", '{"issueId":"nope"}');
    expect(t.routeMemories()).toHaveLength(0);
  });
});

describe("a repository that shares memories with a team", () => {
  it("stops before the first save and before calling the app", async () => {
    const t = setup({ shared: true });
    expect(await t.run("run", "linear", "linear_issue_create", "--args", '{"title":"x","teamId":"t"}')).toBe(1);
    expect(t.executed).toHaveLength(0);
    expect(t.remembered).toHaveLength(0);
    expect(t.err.join("\n")).toContain("--share");
  });
  it("proceeds with --share and does not ask again", async () => {
    const t = setup({ shared: true });
    expect(await t.run("fetch", "linear", "linear_issue_get", "--args", '{"issueId":"DX-42"}', "--share")).toBe(0);
    expect(await t.run("fetch", "linear", "linear_issue_get", "--args", '{"issueId":"DX-43"}')).toBe(0);
    expect(t.contextMemories()).toHaveLength(2);
  });
});

describe("search connectors", () => {
  it("marks a connector the user can use right now as ready, with its connection name", async () => {
    const t = setup();
    expect(await t.run("search", "connectors", "linear")).toBe(0);
    expect(t.out).toHaveLength(1);
    expect(t.out[0]).toContain("ready");
    expect(t.out[0]).toContain("connection=linear");
  });
  it("marks a connection without an active account as needing authorization", async () => {
    const t = setup();
    await t.run("search", "connectors", "slack");
    expect(t.out[0]).toContain("needs authorization");
    expect(t.out[0]).not.toContain("ready");
  });
  it("marks a catalog connector with no connection as not set up", async () => {
    const t = setup();
    await t.run("search", "connectors", "notion");
    expect(t.out[0]).toContain("not set up");
  });
  it("points to the full catalog when nothing matches", async () => {
    const t = setup();
    expect(await t.run("search", "connectors", "zzz")).toBe(0);
    expect(t.out.join("\n")).toContain("docs.scalekit.com/agentkit/connectors");
  });
  it("needs words to search for", async () => {
    const t = setup();
    expect(await t.run("search", "connectors")).toBe(1);
  });
});

describe("search tools", () => {
  it("lists matching tools with a read or write label", async () => {
    const t = setup();
    expect(await t.run("search", "tools", "linear", "issue")).toBe(0);
    expect(t.out).toHaveLength(2);
    expect(t.out.find((l) => l.startsWith("linear_issue_get"))).toContain("  read  ");
    expect(t.out.find((l) => l.startsWith("linear_issue_create"))).toContain("  write  ");
  });
  it("lists every tool when no words are given", async () => {
    const t = setup();
    await t.run("search", "tools", "linear");
    expect(t.out).toHaveLength(3);
  });
  it("prints the inputs with --schema", async () => {
    const t = setup();
    await t.run("search", "tools", "linear", "create", "--schema");
    expect(t.out.join("\n")).toContain('"teamId"');
  });
  it("explains an unknown connection", async () => {
    const t = setup();
    expect(await t.run("search", "tools", "jira")).toBe(1);
    expect(t.err.join("\n")).toContain("search connectors");
  });
});

describe("connect", () => {
  it("creates a missing connection and prints the link for a person to open", async () => {
    const t = setup();
    expect(await t.run("connect", "NOTION")).toBe(0);
    expect(t.created).toEqual([{ name: "notion", provider: "NOTION" }]);
    expect(t.out.join("\n")).toContain("https://example.test/magicLink/notion");
    expect(t.out.join("\n")).toContain("5 minutes");
  });
  it("reuses an existing connection, found by connector or by connection name", async () => {
    const t = setup();
    await t.run("connect", "SLACK");
    await t.run("connect", "slack");
    expect(t.created).toHaveLength(0);
    expect(t.out.filter((l) => l.includes("magicLink/slack"))).toHaveLength(2);
  });
  it("says when the user is already authorized", async () => {
    const t = setup();
    await t.run("connect", "linear");
    expect(t.out.join("\n")).toContain("already authorized");
  });
  it("refuses a connector that is not in the catalog", async () => {
    const t = setup();
    expect(await t.run("connect", "nope")).toBe(1);
    expect(t.created).toHaveLength(0);
  });
});

describe("agent-guide and usage", () => {
  it("prints the lines for the repository's agent guide", async () => {
    const t = setup();
    expect(await t.run("agent-guide")).toBe(0);
    expect(t.out.join("\n")).toBe(AGENT_GUIDE);
  });
  it("keeps the README copy of the agent guide identical", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toContain(AGENT_GUIDE);
  });
  it("points the cookbook at the real commands", () => {
    const book = readFileSync(new URL("../COOKBOOK.md", import.meta.url), "utf8");
    for (const command of [
      "entire scalekit search connectors",
      "entire scalekit search tools",
      "entire scalekit connect",
      "entire scalekit fetch",
      "entire scalekit run",
      "entire scalekit show",
      "entire scalekit refresh",
      "entire scalekit agent-guide",
      "ENTIRE_PLUGIN_ENV='SCALEKIT_*'",
    ]) {
      expect(book).toContain(command);
    }
  });
  it("prints the usage for an unknown command", async () => {
    const t = setup();
    expect(await t.run("nope")).toBe(1);
    expect(t.err.join("\n")).toContain("entire scalekit fetch");
  });
});
