import { describe, expect, it } from "vitest";
import { buildItem, brainPath, itemKey, memoryText, redact } from "../src/item.js";

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
