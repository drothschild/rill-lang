import { Type, freshTypeVar } from "./types";

export type Substitution = Map<number, Type>;

export function unify(t1: Type, t2: Type, subst: Substitution = new Map()): Substitution {
  t1 = applySubst(subst, t1);
  t2 = applySubst(subst, t2);

  if (t1.kind === "TVar") return bindVar(t1.id, t2, subst);
  if (t2.kind === "TVar") return bindVar(t2.id, t1, subst);

  if (t1.kind === "TCon" && t2.kind === "TCon") {
    if (t1.name !== t2.name) throw new TypeError(`Cannot unify ${t1.name} with ${t2.name}`);
    return subst;
  }

  if (t1.kind === "TFn" && t2.kind === "TFn") {
    subst = unify(t1.param, t2.param, subst);
    return unify(t1.ret, t2.ret, subst);
  }

  if (t1.kind === "TList" && t2.kind === "TList") {
    return unify(t1.element, t2.element, subst);
  }

  if (t1.kind === "TTuple" && t2.kind === "TTuple") {
    if (t1.elements.length !== t2.elements.length) throw new TypeError("Tuple length mismatch");
    for (let i = 0; i < t1.elements.length; i++) {
      subst = unify(t1.elements[i], t2.elements[i], subst);
    }
    return subst;
  }

  if (t1.kind === "TResult" && t2.kind === "TResult") {
    return unify(t1.ok, t2.ok, subst);
  }

  if (t1.kind === "TRecord" && t2.kind === "TRecord") {
    // Leijen "scoped labels" row unification.
    // 1. Unify fields present on BOTH sides pairwise; collect one-side-only fields.
    const only1 = new Map<string, Type>(); // in t1, not in t2
    const only2 = new Map<string, Type>(); // in t2, not in t1
    for (const [k, v] of t1.fields) {
      const other = t2.fields.get(k);
      if (other) subst = unify(v, other, subst);
      else only1.set(k, v);
    }
    for (const [k, v] of t2.fields) {
      if (!t1.fields.has(k)) only2.set(k, v);
    }

    // 2 & 3. Push one-side-only fields into the OTHER side's row tail, sharing a fresh tail.
    // t1's extra fields (only1) must be absorbed by t2's tail; t2's extras (only2) by t1's tail.
    const sharedTail = freshTypeVar();
    subst = unifyRowTail(t1.rest, only2, sharedTail, subst);
    subst = unifyRowTail(t2.rest, only1, sharedTail, subst);
    return subst;
  }

  throw new TypeError(`Cannot unify ${t1.kind} with ${t2.kind}`);
}

function bindVar(id: number, t: Type, subst: Substitution): Substitution {
  if (t.kind === "TVar" && t.id === id) return subst;
  if (occursIn(id, t, subst)) throw new TypeError("infinite type");
  subst.set(id, t);
  return subst;
}

// Unify a record's row tail against "the fields the other record has that this one lacks,
// plus a shared residual tail". A null tail means a CLOSED record: it may only match when it
// is asked to provide no extra fields.
function unifyRowTail(
  rest: Type | null,
  missingFields: Map<string, Type>,
  sharedTail: Type,
  subst: Substitution
): Substitution {
  if (rest === null) {
    // Closed record: cannot grow. If the other side demands fields we don't have, fail.
    if (missingFields.size > 0) {
      throw new TypeError(
        `record is missing field(s): ${[...missingFields.keys()].join(", ")}`
      );
    }
    // No extra fields required; the shared tail is therefore the empty closed row.
    return unify(sharedTail, { kind: "TRecord", fields: new Map(), rest: null }, subst);
  }
  // Open record: its tail must equal {missingFields | sharedTail}
  // (or just sharedTail when there are no missing fields).
  const target: Type =
    missingFields.size === 0
      ? sharedTail
      : { kind: "TRecord", fields: missingFields, rest: sharedTail };
  return unify(rest, target, subst);
}

function occursIn(id: number, t: Type, subst: Substitution): boolean {
  t = applySubst(subst, t);
  if (t.kind === "TVar") return t.id === id;
  if (t.kind === "TFn") return occursIn(id, t.param, subst) || occursIn(id, t.ret, subst);
  if (t.kind === "TList") return occursIn(id, t.element, subst);
  if (t.kind === "TTuple") return t.elements.some((el) => occursIn(id, el, subst));
  if (t.kind === "TResult") return occursIn(id, t.ok, subst);
  if (t.kind === "TRecord") {
    return (
      [...t.fields.values()].some((v) => occursIn(id, v, subst)) ||
      (t.rest !== null && occursIn(id, t.rest, subst))
    );
  }
  return false;
}

export function applySubst(subst: Substitution, t: Type): Type {
  switch (t.kind) {
    case "TVar": return subst.has(t.id) ? applySubst(subst, subst.get(t.id)!) : t;
    case "TCon": return t;
    case "TFn": return { kind: "TFn", param: applySubst(subst, t.param), ret: applySubst(subst, t.ret) };
    case "TList": return { kind: "TList", element: applySubst(subst, t.element) };
    case "TTuple": return { kind: "TTuple", elements: t.elements.map((el) => applySubst(subst, el)) };
    case "TRecord": return {
      kind: "TRecord",
      fields: new Map([...t.fields.entries()].map(([k, v]) => [k, applySubst(subst, v)])),
      rest: t.rest ? applySubst(subst, t.rest) : null,
    };
    case "TResult": return { kind: "TResult", ok: applySubst(subst, t.ok) };
    case "TTag": return { kind: "TTag", tag: t.tag, args: t.args.map((a) => applySubst(subst, a)) };
  }
}
