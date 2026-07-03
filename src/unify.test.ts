import { describe, it, expect, beforeEach } from "vitest";
import { unify, Substitution, applySubst } from "./unify";
import { Type, freshTypeVar, resetTypeVarCounter } from "./types";

describe("Unification", () => {
  beforeEach(() => resetTypeVarCounter());

  it("unifies identical concrete types", () => {
    const subst = unify({ kind: "TCon", name: "Int" }, { kind: "TCon", name: "Int" });
    expect(subst.size).toBe(0);
  });

  it("fails on different concrete types", () => {
    expect(() => unify({ kind: "TCon", name: "Int" }, { kind: "TCon", name: "String" }))
      .toThrow("Int");
  });

  it("unifies a type variable with a concrete type", () => {
    const a = freshTypeVar() as { kind: "TVar"; id: number };
    const subst = unify(a, { kind: "TCon", name: "Int" });
    expect(applySubst(subst, a)).toEqual({ kind: "TCon", name: "Int" });
  });

  it("unifies two type variables", () => {
    const a = freshTypeVar();
    const b = freshTypeVar();
    const subst = unify(a, b);
    expect(applySubst(subst, a)).toEqual(applySubst(subst, b));
  });

  it("unifies function types", () => {
    const a = freshTypeVar();
    const t1: Type = { kind: "TFn", param: a, ret: { kind: "TCon", name: "Int" } };
    const t2: Type = { kind: "TFn", param: { kind: "TCon", name: "String" }, ret: { kind: "TCon", name: "Int" } };
    const subst = unify(t1, t2);
    expect(applySubst(subst, a)).toEqual({ kind: "TCon", name: "String" });
  });

  it("unifies list types", () => {
    const a = freshTypeVar();
    const subst = unify(
      { kind: "TList", element: a },
      { kind: "TList", element: { kind: "TCon", name: "Int" } },
    );
    expect(applySubst(subst, a)).toEqual({ kind: "TCon", name: "Int" });
  });

  it("performs occurs check", () => {
    const a = freshTypeVar();
    expect(() => unify(a, { kind: "TList", element: a })).toThrow("infinite");
  });
});

describe("Row unification", () => {
  beforeEach(() => resetTypeVarCounter());

  it("AC3.1: unifies shared field, absorbs one-side-only field into tail", () => {
    // { a: Int | r1 } with { a: Int, b: String | r2 }
    const r1 = freshTypeVar() as { kind: "TVar"; id: number };
    const r2 = freshTypeVar();
    const t1: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "Int" }]]),
      rest: r1,
    };
    const t2: Type = {
      kind: "TRecord",
      fields: new Map([
        ["a", { kind: "TCon", name: "Int" }],
        ["b", { kind: "TCon", name: "String" }],
      ]),
      rest: r2,
    };

    const subst = unify(t1, t2);

    // r1 should have absorbed b: String
    const r1Resolved = applySubst(subst, r1);
    expect(r1Resolved.kind).toBe("TRecord");
    if (r1Resolved.kind === "TRecord") {
      expect(r1Resolved.fields.has("b")).toBe(true);
      const bType = r1Resolved.fields.get("b");
      expect(bType).toEqual({ kind: "TCon", name: "String" });
    }
  });

  it("AC3.2: disjoint extra fields absorbed by each side's tail", () => {
    // { a: Int | r1 } with { b: String | r2 }
    const r1 = freshTypeVar() as { kind: "TVar"; id: number };
    const r2 = freshTypeVar() as { kind: "TVar"; id: number };
    const t1: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "Int" }]]),
      rest: r1,
    };
    const t2: Type = {
      kind: "TRecord",
      fields: new Map([["b", { kind: "TCon", name: "String" }]]),
      rest: r2,
    };

    const subst = unify(t1, t2);

    // r1 should have absorbed b: String
    const r1Resolved = applySubst(subst, r1);
    expect(r1Resolved.kind).toBe("TRecord");
    if (r1Resolved.kind === "TRecord") {
      expect(r1Resolved.fields.has("b")).toBe(true);
    }

    // r2 should have absorbed a: Int
    const r2Resolved = applySubst(subst, r2);
    expect(r2Resolved.kind).toBe("TRecord");
    if (r2Resolved.kind === "TRecord") {
      expect(r2Resolved.fields.has("a")).toBe(true);
    }
  });

  it("AC3.3a: fails when shared field has conflicting types", () => {
    // { a: Int | r1 } with { a: String | r2 }
    const r1 = freshTypeVar();
    const r2 = freshTypeVar();
    const t1: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "Int" }]]),
      rest: r1,
    };
    const t2: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "String" }]]),
      rest: r2,
    };

    expect(() => unify(t1, t2)).toThrow();
  });

  it("AC3.3b: occurs-check prevents infinite record type through rest", () => {
    // r should not unify with { a: Int | r } (infinite record)
    const r = freshTypeVar();
    const infiniteRecord: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "Int" }]]),
      rest: r,
    };

    expect(() => unify(r, infiniteRecord)).toThrow(/infinite type/);
  });
});
