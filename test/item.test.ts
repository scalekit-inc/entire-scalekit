import { describe, expect, it } from "vitest";
import { appError, buildItem, brainPath, itemKey, memoryText, redact, routeText, writeKey } from "../src/item.js";

const base = { connector: "linear", tool: "linear-issues-get", args: { id: "DX-42" }, userId: "user@x.com", data: { title: "List in Entire" }, executionId: "ex_1", now: new Date("2026-11-09T10:00:00Z") };

describe("itemKey", () => {
  it("is stable for the same call and ignores argument order", () => {
    expect(itemKey("linear", "t", { a: 1, b: 2 })).toBe(itemKey("linear", "t", { b: 2, a: 1 }));
  });
  it("differs when arguments differ", () => {
    expect(itemKey("linear", "t", { a: 1 })).not.toBe(itemKey("linear", "t", { a: 2 }));
  });
  it("exists with empty arguments", () => {
    expect(itemKey("slack", "t", {})).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("brainPath", () => {
  it("uses project root with underscores and lowercase", () => {
    expect(brainPath("GitHub-Connect", "issues-get")).toBe("project.github_connect.issues_get");
  });
  it("has exactly three segments", () => {
    expect(brainPath("a.b", "c d").split(".")).toHaveLength(3);
  });
});

describe("redact", () => {
  it("removes bearer tokens and secret-looking values", () => {
    const out = redact('Authorization: Bearer abc.def.ghi and "api_key": "sk-12345678901234567890"');
    expect(out).not.toContain("abc.def.ghi");
    expect(out).not.toContain("sk-12345678901234567890");
  });
});

describe("buildItem", () => {
  it("hashes the user and never stores the raw identifier", () => {
    const item = buildItem(base);
    expect(item.user).not.toContain("user@x.com");
    expect(JSON.stringify(item)).not.toContain("user@x.com");
  });
  it("records fetch time, execution id and key", () => {
    const item = buildItem(base);
    expect(item.fetchedAt).toBe("2026-11-09T10:00:00.000Z");
    expect(item.executionId).toBe("ex_1");
    expect(item.key).toHaveLength(12);
  });
});

describe("memoryText", () => {
  it("keeps small content inline with the key", () => {
    const item = buildItem(base);
    const { text, overflow } = memoryText(item);
    expect(overflow).toBe(false);
    expect(text).toContain(item.key);
    expect(text).toContain("List in Entire");
  });
  it("turns large content into a pointer", () => {
    const item = buildItem({ ...base, data: { body: "x".repeat(20000) } });
    const { text, overflow } = memoryText(item);
    expect(overflow).toBe(true);
    expect(text.length).toBeLessThan(1000);
    expect(text).toContain(`entire scalekit show ${item.key}`);
  });
});

describe("writeKey", () => {
  it("differs for two executions of the same write", () => {
    const a = writeKey("linear", "linear_issue_create", { title: "x" }, "ex_1");
    const b = writeKey("linear", "linear_issue_create", { title: "x" }, "ex_2");
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
  it("differs from the read key for the same call", () => {
    expect(writeKey("linear", "t", { a: 1 }, "ex_1")).not.toBe(itemKey("linear", "t", { a: 1 }));
  });
});

describe("appError", () => {
  it("finds a Slack-style error inside a successful response", () => {
    expect(appError({ ok: false, error: "missing_scope" })).toBe("missing_scope");
  });
  it("finds a GraphQL-style errors list", () => {
    expect(appError({ errors: [{ message: "Entity not found" }] })).toBe("Entity not found");
  });
  it("returns nothing for ordinary data", () => {
    expect(appError({ ok: true, messages: [] })).toBeUndefined();
    expect(appError({ data: { issue: { title: "x" } } })).toBeUndefined();
    expect(appError("plain text")).toBeUndefined();
  });
});

describe("write items", () => {
  it("are marked so they are never repeated", () => {
    const item = buildItem({ ...base, tool: "linear_issue_create", write: true });
    expect(item.write).toBe(true);
    expect(item.key).toBe(writeKey("linear", "linear_issue_create", base.args, "ex_1"));
    expect(memoryText(item).text).toContain("write, do not repeat");
  });
});

describe("routeText", () => {
  it("names the command, connection, tool and inputs, and holds no content", () => {
    const text = routeText({ connection: "linear", tool: "linear_issue_get", description: "Get a Linear issue", readOnly: true, inputs: ["issueId"] });
    expect(text).toContain("entire scalekit fetch linear linear_issue_get");
    expect(text).toContain("Get a Linear issue");
    expect(text).toContain("issueId");
  });
  it("does not double the full stop after a description that ends with one", () => {
    const text = routeText({ connection: "linear", tool: "linear_teams_list", description: "List all teams.", readOnly: true, inputs: [] });
    expect(text).toContain("List all teams. Run:");
  });
  it("uses run for a write tool", () => {
    const text = routeText({ connection: "linear", tool: "linear_issue_create", description: "Create an issue", readOnly: false, inputs: ["title"] });
    expect(text).toContain("entire scalekit run linear linear_issue_create");
  });
});
