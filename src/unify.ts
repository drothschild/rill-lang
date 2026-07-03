import { Type } from "./types";

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
    for (const [k, v] of t1.fields) {
      const other = t2.fields.get(k);
      if (other) subst = unify(v, other, subst);
    }
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
