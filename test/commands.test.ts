import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_GUIDE, runCli } from "../src/commands.js";
import type { ContextItem } from "../src/item.js";
import { sharedAppUnavailable } from "../src/scalekit.js";
import type { CatalogEntry, ConnectionInfo, Deps, ToolInfo } from "../src/ports.js";

const tool = (name: string, readOnly: boolean, description = name, inputs: string[] = ["issueId"]): ToolInfo => ({ name, description, readOnly, inputs, inputSchema: { type: "object", properties: Object.fromEntries(inputs.map((i) => [i, { type: "string" }])), required: inputs } });

interface World {
  catalog: CatalogEntry[];
  connections: ConnectionInfo[];
  ready: string[];
  tools: Record<string, ToolInfo[]>;
  shared: boolean;
  /** Connections that have no OAuth credentials, as Scalekit leaves a newly created one. */
  uncredentialed: string[];
  /** Connectors for which Scalekit offers its own shared OAuth app. */
  sharedOffered: string[];
  /** Connections whose credential check throws. */
  credentialFails: string[];
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
    uncredentialed: [],
    sharedOffered: [],
    credentialFails: [],
    respond: (_c, t) => ({ tool: t, title: "List in Entire" }),
    ...overrides,
  };
  const executed: { connection: string; tool: string; args: Record<string, unknown> }[] = [];
  const remembered: { text: string; path: string }[] = [];
  const created: ConnectionInfo[] = [];
  const sharedEnabled: string[] = [];
  const credentialChecks: string[] = [];
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
      credentialState: async (connection) => {
        credentialChecks.push(connection);
        if (world.credentialFails.includes(connection)) throw new Error("getConnection failed");
        return { usable: !world.uncredentialed.includes(connection), redirectUri: `https://example.test/callback/${connection}` };
      },
      useSharedCredentials: async (connection) => {
        const provider = world.connections.find((c) => c.name === connection)?.provider ?? "";
        if (!world.sharedOffered.includes(provider)) return false;
        sharedEnabled.push(connection);
        world.uncredentialed = world.uncredentialed.filter((n) => n !== connection);
        return true;
      },
      authorizationLink: async (connection) => `https://example.test/magicLink/${connection}`,
      execute: async (connection, t, args) => { executed.push({ connection, tool: t, args }); return { data: world.respond(connection, t, args), executionId: `ex_${++n}` }; },
    },
    brain: { remember: (text, path) => { remembered.push({ text, path }); }, shared: () => world.shared },
    store: { save: (i) => { items.set(i.key, i); }, load: (k) => items.get(k), has: (f) => flags.has(f), set: (f) => { flags.add(f); } },
  };
  const run = (...argv: string[]) => runCli(argv, deps);
  const contextMemories = () => remembered.filter((m) => m.path.startsWith("project."));
  const routeMemories = () => remembered.filter((m) => m.path.startsWith("workflow."));
  return { world, run, executed, remembered, created, sharedEnabled, credentialChecks, items, out, err, contextMemories, routeMemories };
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
  it("tells the person to run connect when the connected account is not active", async () => {
    const t = setup({ ready: [], respond: () => { throw new Error("[invalid_argument] connected account is not active"); } });
    expect(await t.run("fetch", "linear", "linear_issue_get", "--args", '{"issueId":"DX-42"}')).toBe(1);
    const said = t.err.join("\n");
    expect(said).toContain("entire scalekit connect linear");
    expect(said).toContain("Nothing was saved");
    expect(t.remembered).toHaveLength(0);
  });
  it("does not blame the account when it is active and the error is about something else", async () => {
    const t = setup({ respond: () => { throw new Error("tool is not active in this environment"); } });
    await expect(t.run("fetch", "linear", "linear_issue_get", "--args", '{"issueId":"DX-42"}')).rejects.toThrow("tool is not active");
  });
  it("lets other errors through unchanged", async () => {
    const t = setup({ respond: () => { throw new Error("upstream exploded"); } });
    await expect(t.run("fetch", "linear", "linear_issue_get", "--args", '{"issueId":"DX-42"}')).rejects.toThrow("upstream exploded");
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

describe("show usage", () => {
  it("says where to find a key when none is given", async () => {
    const t = setup();
    expect(await t.run("show")).toBe(1);
    expect(t.err.join("\n")).toContain("Scalekit context");
  });
});

describe("refresh usage", () => {
  it("shows how to use refresh and where to find a key when none is given", async () => {
    const t = setup();
    expect(await t.run("refresh")).toBe(1);
    const said = t.err.join("\n");
    expect(said).toContain("entire scalekit refresh <key>");
    expect(said).toContain("Scalekit context");
    expect(said).not.toBe("No saved item for that key.");
  });
  it("still says no saved item for a key that does not exist", async () => {
    const t = setup();
    expect(await t.run("refresh", "nope")).toBe(1);
    expect(t.err.join("\n")).toBe("No saved item for that key.");
  });
});

describe("search tools", () => {
  const many = Array.from({ length: 14 }, (_, i) => tool(`linear_issue_${i}`, true, `Do issue thing ${i}`));
  it("shows at most 10 tools and says how many were left out", async () => {
    const t = setup({ tools: { LINEAR: many } });
    expect(await t.run("search", "tools", "linear", "issue")).toBe(0);
    expect(t.out.filter((l) => l.startsWith("linear_issue_"))).toHaveLength(10);
    expect(t.out.join("\n")).toContain("4 more");
  });
  it("shows every match with --all", async () => {
    const t = setup({ tools: { LINEAR: many } });
    await t.run("search", "tools", "linear", "issue", "--all");
    expect(t.out.filter((l) => l.startsWith("linear_issue_"))).toHaveLength(14);
    expect(t.out.join("\n")).not.toContain("more match");
  });
  it("offers --all in the hint and does not invent a word to add", async () => {
    const t = setup({ tools: { LINEAR: many } });
    await t.run("search", "tools", "linear");
    const hint = t.out.find((l) => l.includes("more match")) ?? "";
    expect(hint).toContain("--all");
    expect(hint).not.toContain(" get");
  });
  it("shows everything when there are 10 or fewer", async () => {
    const t = setup();
    await t.run("search", "tools", "linear", "issue");
    expect(t.out.join("\n")).not.toContain("more");
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
  it("marks a connection with no OAuth credentials as needing them, not as needing authorization", async () => {
    const t = setup({ uncredentialed: ["slack"] });
    await t.run("search", "connectors", "slack");
    expect(t.out[0]).toContain("needs OAuth credentials");
    expect(t.out[0]).not.toContain("needs authorization");
    expect(t.out[0]).toContain("entire scalekit connect slack");
  });
  it("does not check credentials on a connection that is already ready", async () => {
    const t = setup({ uncredentialed: ["linear"] });
    await t.run("search", "connectors", "linear");
    expect(t.out[0]).toContain("ready");
    expect(t.credentialChecks).toHaveLength(0);
  });
  it("falls back to needs authorization for a row whose credential check fails, and still lists the rest", async () => {
    const t = setup({ credentialFails: ["slack"], connections: [{ name: "slack", provider: "SLACK" }, { name: "slack2", provider: "SLACK" }], uncredentialed: ["slack2"] });
    expect(await t.run("search", "connectors", "slack")).toBe(0);
    expect(t.out.some((l) => l.includes("connection=slack ") && l.includes("needs authorization"))).toBe(true);
    expect(t.out.some((l) => l.includes("connection=slack2") && l.includes("needs OAuth credentials"))).toBe(true);
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

  describe("a connection with no OAuth credentials", () => {
    it("switches to Scalekit's shared app when the connector offers one, then prints the link", async () => {
      const t = setup({ uncredentialed: ["notion"], sharedOffered: ["NOTION"] });
      expect(await t.run("connect", "NOTION")).toBe(0);
      expect(t.sharedEnabled).toEqual(["notion"]);
      expect(t.out.join("\n")).toContain("https://example.test/magicLink/notion");
      expect(t.out.join("\n")).toContain("development");
      expect(t.out.join("\n")).toContain("your own credentials");
    });
    it("prints no link and says how to add credentials when Scalekit has no shared app for the connector", async () => {
      const t = setup({ uncredentialed: ["notion"] });
      expect(await t.run("connect", "NOTION")).toBe(1);
      const said = t.err.join("\n");
      expect(t.out.join("\n")).not.toContain("magicLink");
      expect(said).toContain("client ID");
      expect(said).toContain("https://example.test/callback/notion");
      expect(said).toContain("AgentKit > Connections");
      expect(said).toContain("https://app.scalekit.com");
      expect(said).toContain("no shared OAuth app");
      expect(said).toContain("when Scalekit offers one");
      expect(said).toContain("https://docs.scalekit.com/agentkit/connectors/notion/");
      expect(said).toContain("entire scalekit connect notion");
    });
    it("applies to an existing connection too, not only a new one", async () => {
      const t = setup({ uncredentialed: ["slack"] });
      expect(await t.run("connect", "slack")).toBe(1);
      expect(t.created).toHaveLength(0);
      expect(t.out.join("\n")).not.toContain("magicLink");
    });
    it("leaves a connection that already has credentials alone", async () => {
      const t = setup({ sharedOffered: ["SLACK"] });
      await t.run("connect", "slack");
      expect(t.sharedEnabled).toHaveLength(0);
    });
    it("does not change an existing connection's credentials, even when Scalekit has a shared app", async () => {
      const t = setup({ uncredentialed: ["slack"], sharedOffered: ["SLACK"] });
      expect(await t.run("connect", "slack")).toBe(1);
      expect(t.sharedEnabled).toHaveLength(0);
      const said = t.err.join("\n");
      expect(said).toContain("If Scalekit offers its own credentials");
      expect(said).not.toContain("has no shared OAuth app");
    });
    it("builds the setup page address without separators and points at the catalog as a fallback", async () => {
      const t = setup({ catalog: [{ identifier: "GOOGLE_TASKS", displayName: "Google Tasks", description: "Tasks" }], uncredentialed: ["google_tasks"] });
      expect(await t.run("connect", "GOOGLE_TASKS")).toBe(1);
      const said = t.err.join("\n");
      expect(said).toContain("https://docs.scalekit.com/agentkit/connectors/googletasks/");
      expect(said).toContain("https://docs.scalekit.com/agentkit/connectors/");
    });
    it("does not claim the connection is ready after creating it", async () => {
      const t = setup({ uncredentialed: ["notion"] });
      await t.run("connect", "NOTION");
      expect(t.out.join("\n")).not.toContain("default scopes");
    });
  });
});

describe("agent-guide and usage", () => {
  it("prints the lines for the repository's agent guide", async () => {
    const t = setup();
    expect(await t.run("agent-guide")).toBe(0);
    expect(t.out.join("\n")).toBe(AGENT_GUIDE);
  });
  it("tells the agent what to do when connect finds no OAuth credentials", () => {
    expect(AGENT_GUIDE).toContain("no OAuth credentials");
    expect(AGENT_GUIDE).toContain("app.scalekit.com");
    expect(AGENT_GUIDE).toContain("setup page link");
    expect(AGENT_GUIDE).toContain("connect again");
    expect(AGENT_GUIDE).toContain("no authorized account");
    expect(AGENT_GUIDE).toContain("shared OAuth app");
    expect(AGENT_GUIDE).toContain("needs OAuth credentials");
    expect(AGENT_GUIDE).toContain("up to 10");
  });
  it("tells the agent how to get fresh content when a recalled memory may be stale", () => {
    expect(AGENT_GUIDE).toContain("fetched=");
    expect(AGENT_GUIDE).toContain("entire scalekit refresh <key>");
    expect(AGENT_GUIDE).toContain("newest");
    expect(AGENT_GUIDE).toContain("secret into the chat");
  });
  it("tells the agent to use the plugin for apps it covers even when another tool reaches the same app", () => {
    expect(AGENT_GUIDE).toContain("even if another tool");
    expect(AGENT_GUIDE).toContain("saved in Brain");
    expect(AGENT_GUIDE).toContain("ask the person");
  });
  it("keeps the README copy of the agent guide identical", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toContain(AGENT_GUIDE);
  });
  it("keeps the cookbook's example flows tied to real tools and statuses", () => {
    const book = readFileSync(new URL("../COOKBOOK.md", import.meta.url), "utf8");
    const flows = book.slice(book.indexOf("## Example flows with an agent"), book.indexOf("## Troubleshoot"));
    for (const part of ["### Flow A", "### Flow B", "### Flow C", "linear_issues_list", "needs OAuth credentials", "fetched=", "entire scalekit refresh <key>", "paste the client secret into the chat", "### Make sure the agent reads the guide", "not a valid taxonomy path"]) {
      expect(flows).toContain(part);
    }
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
      "connected-account identifier",
    ]) {
      expect(book).toContain(command);
    }
    expect(book).not.toContain("SCALEKIT_IDENTIFIER");
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toContain("connected-account identifier");
    expect(readme).not.toContain("SCALEKIT_IDENTIFIER");
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    expect(example).not.toContain("SCALEKIT_IDENTIFIER");
  });
  it("prints the usage for an unknown command", async () => {
    const t = setup();
    expect(await t.run("nope")).toBe(1);
    expect(t.err.join("\n")).toContain("entire scalekit fetch");
  });
});

describe("sharedAppUnavailable", () => {
  it("is true for Scalekit's refusal that names unavailable managed credentials", () => {
    expect(sharedAppUnavailable({ code: "INVALID_CONFIGURATION", message: 'Scalekit-managed credentials are not available for connector "GMAIL"' })).toBe(true);
  });
  it("is false for another bad request that shares the code", () => {
    expect(sharedAppUnavailable({ code: "INVALID_CONFIGURATION", message: "scopes must not be empty" })).toBe(false);
  });
  it("is false for another error code", () => {
    expect(sharedAppUnavailable({ code: "CONNECTION_NOT_FOUND", message: "not available" })).toBe(false);
    expect(sharedAppUnavailable(new Error("boom"))).toBe(false);
  });
});
