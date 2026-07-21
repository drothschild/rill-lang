import { describe, it, expect } from "vitest";
import { Type, prettyType, freshTypeVar } from "./types";

describe("Types", () => {
  it("represents primitive types", () => {
    const t: Type = { kind: "TCon", name: "Int" };
    expect(prettyType(t)).toBe("Int");
  });

  it("represents function types", () => {
    const t: Type = {
      kind: "TFn",
      param: { kind: "TCon", name: "Int" },
      ret: { kind: "TCon", name: "Bool" },
    };
    expect(prettyType(t)).toBe("Int -> Bool");
  });

  it("represents type variables", () => {
    const t = freshTypeVar();
    expect(t.kind).toBe("TVar");
    expect(prettyType(t)).toMatch(/^[a-z]/);
  });

  it("generates unique type variable names", () => {
    const a = freshTypeVar();
    const b = freshTypeVar();
    expect(a).not.toEqual(b);
  });

  it("represents list types", () => {
    const t: Type = { kind: "TList", element: { kind: "TCon", name: "Int" } };
    expect(prettyType(t)).toBe("List(Int)");
  });

  it("represents tuple types", () => {
    const t: Type = {
      kind: "TTuple",
      elements: [{ kind: "TCon", name: "Int" }, { kind: "TCon", name: "String" }],
    };
    expect(prettyType(t)).toBe("(Int, String)");
  });

  it("represents record types", () => {
    const t: Type = {
      kind: "TRecord",
      fields: new Map([["name", { kind: "TCon", name: "String" }]]),
      rest: null,
    };
    expect(prettyType(t)).toBe("{ name: String }");
  });

  it("represents union types without arguments", () => {
    const t: Type = { kind: "TUnion", name: "Phase", args: [] };
    expect(prettyType(t)).toBe("Phase");
  });

  it("represents union types with arguments", () => {
    const t: Type = {
      kind: "TUnion",
      name: "Option",
      args: [{ kind: "TCon", name: "Float" }],
    };
    expect(prettyType(t)).toBe("Option(Float)");
  });

  it("represents type parameters", () => {
    const t: Type = { kind: "TParam", name: "a" };
    expect(prettyType(t)).toBe("a");
  });
});
