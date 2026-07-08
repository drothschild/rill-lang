import { describe, it, expect } from "vitest";
import { Value, prettyPrint } from "./values";

describe("Values", () => {
  it("represents primitives", () => {
    const v: Value = { kind: "Int", value: 42 };
    expect(prettyPrint(v)).toBe("42");
  });

  it("represents strings", () => {
    expect(prettyPrint({ kind: "String", value: "hello" })).toBe('"hello"');
  });

  it("escapes double quotes inside strings", () => {
    expect(prettyPrint({ kind: "String", value: 'say "hi"' })).toBe('"say \\"hi\\""');
  });

  it("escapes backslashes inside strings", () => {
    expect(prettyPrint({ kind: "String", value: "a\\b" })).toBe('"a\\\\b"');
  });

  it("escapes newlines, tabs and carriage returns inside strings", () => {
    expect(prettyPrint({ kind: "String", value: "a\nb\tc\rd" })).toBe('"a\\nb\\tc\\rd"');
  });

  it("escapes strings nested in records", () => {
    expect(prettyPrint({
      kind: "Record",
      fields: new Map([["note", { kind: "String", value: 'say "hi"' }]]),
    })).toBe('{ note: "say \\"hi\\"" }');
  });

  it("represents lists", () => {
    expect(prettyPrint({
      kind: "List",
      elements: [{ kind: "Int", value: 1 }, { kind: "Int", value: 2 }],
    })).toBe("[1, 2]");
  });

  it("represents records", () => {
    expect(prettyPrint({
      kind: "Record",
      fields: new Map([["name", { kind: "String", value: "Alice" }]]),
    })).toBe('{ name: "Alice" }');
  });

  it("represents tagged values", () => {
    expect(prettyPrint({
      kind: "Tag",
      tag: "Ok",
      args: [{ kind: "Int", value: 42 }],
    })).toBe("Ok(42)");
  });

  it("represents closures", () => {
    expect(prettyPrint({ kind: "Closure", param: "x", body: {} as any, env: new Map() })).toBe("<fn>");
  });

  it("represents unit", () => {
    expect(prettyPrint({ kind: "Unit" })).toBe("()");
  });
});
