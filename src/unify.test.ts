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
    const r2 = freshTypeVar() as { kind: "TVar"; id: number };
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

    // r1 should have absorbed b: String from t2 (t2 has no r1 extras to absorb)
    const r1Resolved = applySubst(subst, r1);
    expect(r1Resolved.kind).toBe("TRecord");
    if (r1Resolved.kind === "TRecord") {
      expect(r1Resolved.fields.has("b")).toBe(true);
      const bType = r1Resolved.fields.get("b");
      expect(bType).toEqual({ kind: "TCon", name: "String" });
    }

    // r2 was bound to the shared tail (no extras to absorb from t1)
    // Verify symmetric unification: shared field 'a' unified at Int, extras absorbed into tails
    const t1Resolved = applySubst(subst, t1);
    const t2Resolved = applySubst(subst, t2);

    // Both should be TRecord
    expect(t1Resolved.kind).toBe("TRecord");
    expect(t2Resolved.kind).toBe("TRecord");

    if (t1Resolved.kind === "TRecord" && t2Resolved.kind === "TRecord") {
      // Both must have shared field 'a' as Int — proves unification of common field succeeded
      expect(t1Resolved.fields.has("a")).toBe(true);
      expect(t2Resolved.fields.has("a")).toBe(true);
      expect(t1Resolved.fields.get("a")).toEqual({ kind: "TCon", name: "Int" });
      expect(t2Resolved.fields.get("a")).toEqual({ kind: "TCon", name: "Int" });

      // t2 has field 'b' directly (it was in original t2)
      expect(t2Resolved.fields.has("b")).toBe(true);
      expect(t2Resolved.fields.get("b")).toEqual({ kind: "TCon", name: "String" });

      // r1 (t1's rest) must have absorbed b: String
      // Apply substitution to r1 (which is t1Resolved.rest)
      const r1Resolved = t1Resolved.rest ? applySubst(subst, t1Resolved.rest) : null;
      expect(r1Resolved?.kind).toBe("TRecord");
      if (r1Resolved?.kind === "TRecord") {
        expect(r1Resolved.fields.has("b")).toBe(true);
        expect(r1Resolved.fields.get("b")).toEqual({ kind: "TCon", name: "String" });
      }

      // r2 was bound to the shared tail (unbound TVar); verify it's a TVar
      const r2Resolved = applySubst(subst, r2);
      expect(r2Resolved.kind).toBe("TVar");
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

    expect(() => unify(t1, t2)).toThrow(/Int|String/);
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

  it("closed record with no missing fields unifies with open record tail resolving to empty closed row", () => {
    // { a: Int } CLOSED vs { a: Int | r } OPEN
    // r should unify to { } CLOSED (empty record with rest: null)
    const r = freshTypeVar() as { kind: "TVar"; id: number };
    const closedRecord: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "Int" }]]),
      rest: null,
    };
    const openRecord: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "Int" }]]),
      rest: r,
    };

    const subst = unify(closedRecord, openRecord);

    // r should resolve to empty closed record
    const rResolved = applySubst(subst, r);
    expect(rResolved.kind).toBe("TRecord");
    if (rResolved.kind === "TRecord") {
      expect(rResolved.fields.size).toBe(0);
      expect(rResolved.rest).toBe(null);
    }
  });

  it("closed record with missing required field throws error", () => {
    // { a: Int } CLOSED vs { a: Int, b: String } CLOSED
    // Should throw because closed record cannot provide b
    const closedRecord1: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "Int" }]]),
      rest: null,
    };
    const closedRecord2: Type = {
      kind: "TRecord",
      fields: new Map([
        ["a", { kind: "TCon", name: "Int" }],
        ["b", { kind: "TCon", name: "String" }],
      ]),
      rest: null,
    };

    expect(() => unify(closedRecord1, closedRecord2)).toThrow(/missing field/);
  });

  it("unifies two closed records with identical field sets (terminates)", () => {
    // { a: Int } CLOSED vs { a: Int } CLOSED — must succeed, not recurse forever
    const t1: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "Int" }]]),
      rest: null,
    };
    const t2: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "Int" }]]),
      rest: null,
    };

    const subst = unify(t1, t2);
    expect(subst.size).toBe(0);
  });

  it("unifies closed records pointwise, solving field type variables", () => {
    const a = freshTypeVar() as { kind: "TVar"; id: number };
    const t1: Type = { kind: "TRecord", fields: new Map([["x", a]]), rest: null };
    const t2: Type = {
      kind: "TRecord",
      fields: new Map([["x", { kind: "TCon", name: "Int" }]]),
      rest: null,
    };

    const subst = unify(t1, t2);
    expect(applySubst(subst, a)).toEqual({ kind: "TCon", name: "Int" });
  });

  it("fails when closed records have disjoint field sets", () => {
    const t1: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "Int" }]]),
      rest: null,
    };
    const t2: Type = {
      kind: "TRecord",
      fields: new Map([["b", { kind: "TCon", name: "String" }]]),
      rest: null,
    };

    expect(() => unify(t1, t2)).toThrow(/missing field/);
  });

  it("fails when closed records share fields but field types conflict", () => {
    const t1: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "Int" }]]),
      rest: null,
    };
    const t2: Type = {
      kind: "TRecord",
      fields: new Map([["a", { kind: "TCon", name: "String" }]]),
      rest: null,
    };

    expect(() => unify(t1, t2)).toThrow(/Int|String/);
  });
});

describe("Tag unification", () => {
  beforeEach(() => resetTypeVarCounter());

  it("occurs check catches a tag wrapping its own type variable", () => {
    const a = freshTypeVar();
    expect(() => unify(a, { kind: "TTag", tag: "Some", args: [a] })).toThrow(/infinite type/);
  });

  it("unifies identical tags pointwise", () => {
    const a = freshTypeVar() as { kind: "TVar"; id: number };
    const subst = unify(
      { kind: "TTag", tag: "Some", args: [a] },
      { kind: "TTag", tag: "Some", args: [{ kind: "TCon", name: "Int" }] },
    );
    expect(applySubst(subst, a)).toEqual({ kind: "TCon", name: "Int" });
  });

  it("unifies identical nullary tags", () => {
    const subst = unify(
      { kind: "TTag", tag: "None", args: [] },
      { kind: "TTag", tag: "None", args: [] },
    );
    expect(subst.size).toBe(0);
  });

  it("fails on different tags with a message naming both", () => {
    const t1: Type = { kind: "TTag", tag: "Some", args: [{ kind: "TCon", name: "Int" }] };
    const t2: Type = { kind: "TTag", tag: "None", args: [] };
    expect(() => unify(t1, t2)).toThrow(/tag Some.*tag None/);
  });

  it("fails on the same tag with different arity", () => {
    const t1: Type = { kind: "TTag", tag: "Pair", args: [{ kind: "TCon", name: "Int" }] };
    const t2: Type = {
      kind: "TTag",
      tag: "Pair",
      args: [{ kind: "TCon", name: "Int" }, { kind: "TCon", name: "Int" }],
    };
    expect(() => unify(t1, t2)).toThrow(/arity/);
  });
});

describe("Union unification", () => {
  beforeEach(() => resetTypeVarCounter());

  it("unifies identical unions without arguments", () => {
    const t1: Type = { kind: "TUnion", name: "Phase", args: [] };
    const t2: Type = { kind: "TUnion", name: "Phase", args: [] };
    const subst = unify(t1, t2);
    expect(subst.size).toBe(0);
  });

  it("unifies identical unions with concrete arguments", () => {
    const t1: Type = {
      kind: "TUnion",
      name: "Option",
      args: [{ kind: "TCon", name: "Int" }],
    };
    const t2: Type = {
      kind: "TUnion",
      name: "Option",
      args: [{ kind: "TCon", name: "Int" }],
    };
    const subst = unify(t1, t2);
    expect(subst.size).toBe(0);
  });

  it("unifies unions with type variables", () => {
    const a = freshTypeVar() as { kind: "TVar"; id: number };
    const t1: Type = { kind: "TUnion", name: "Option", args: [a] };
    const t2: Type = {
      kind: "TUnion",
      name: "Option",
      args: [{ kind: "TCon", name: "Int" }],
    };
    const subst = unify(t1, t2);
    expect(applySubst(subst, a)).toEqual({ kind: "TCon", name: "Int" });
  });

  it("fails on different union names with message naming both", () => {
    const t1: Type = { kind: "TUnion", name: "Phase", args: [] };
    const t2: Type = { kind: "TUnion", name: "Event", args: [] };
    expect(() => unify(t1, t2)).toThrow(/Phase.*Event/);
  });

  it("fails on same union name with different arity", () => {
    const t1: Type = { kind: "TUnion", name: "Option", args: [] };
    const t2: Type = {
      kind: "TUnion",
      name: "Option",
      args: [{ kind: "TCon", name: "Int" }],
    };
    expect(() => unify(t1, t2)).toThrow(/arity/);
  });
});
