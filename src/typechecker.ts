import { Expr } from "./ast";
import { Type, freshTypeVar, prettyType } from "./types";
import { Substitution, unify, applySubst } from "./unify";
import { RillError } from "./errors";
import { Span } from "./span";

// A type scheme: forall quantifiedVars . type
interface Scheme {
  vars: number[];
  type: Type;
}

export type TypeEnv = Map<string, Scheme>;

function mono(t: Type): Scheme {
  return { vars: [], type: t };
}

function freeVars(t: Type): Set<number> {
  switch (t.kind) {
    case "TVar": return new Set([t.id]);
    case "TCon": return new Set();
    case "TFn": return union(freeVars(t.param), freeVars(t.ret));
    case "TList": return freeVars(t.element);
    case "TTuple": return t.elements.reduce((s, e) => union(s, freeVars(e)), new Set<number>());
    case "TRecord": {
      let s = new Set<number>();
      for (const v of t.fields.values()) s = union(s, freeVars(v));
      if (t.rest) s = union(s, freeVars(t.rest));
      return s;
    }
    case "TResult": return freeVars(t.ok);
    case "TTag": return t.args.reduce((s, a) => union(s, freeVars(a)), new Set<number>());
  }
}

function freeVarsScheme(s: Scheme): Set<number> {
  const fv = freeVars(s.type);
  for (const v of s.vars) fv.delete(v);
  return fv;
}

function freeVarsEnv(env: TypeEnv): Set<number> {
  let result = new Set<number>();
  for (const s of env.values()) result = union(result, freeVarsScheme(s));
  return result;
}

function union(a: Set<number>, b: Set<number>): Set<number> {
  const result = new Set(a);
  for (const x of b) result.add(x);
  return result;
}

function generalize(env: TypeEnv, t: Type, subst: Substitution): Scheme {
  const resolved = applySubst(subst, t);
  const envFree = freeVarsEnv(applySubstEnv(subst, env));
  const tFree = freeVars(resolved);
  const vars: number[] = [];
  for (const v of tFree) {
    if (!envFree.has(v)) vars.push(v);
  }
  return { vars, type: resolved };
}

function instantiate(scheme: Scheme): Type {
  const mapping = new Map<number, Type>();
  for (const v of scheme.vars) {
    mapping.set(v, freshTypeVar());
  }
  return substituteVars(mapping, scheme.type);
}

function substituteVars(mapping: Map<number, Type>, t: Type): Type {
  switch (t.kind) {
    case "TVar": return mapping.get(t.id) ?? t;
    case "TCon": return t;
    case "TFn": return { kind: "TFn", param: substituteVars(mapping, t.param), ret: substituteVars(mapping, t.ret) };
    case "TList": return { kind: "TList", element: substituteVars(mapping, t.element) };
    case "TTuple": return { kind: "TTuple", elements: t.elements.map(e => substituteVars(mapping, e)) };
    case "TRecord": return {
      kind: "TRecord",
      fields: new Map([...t.fields.entries()].map(([k, v]) => [k, substituteVars(mapping, v)])),
      rest: t.rest ? substituteVars(mapping, t.rest) : null,
    };
    case "TResult": return { kind: "TResult", ok: substituteVars(mapping, t.ok) };
    case "TTag": return { kind: "TTag", tag: t.tag, args: t.args.map(a => substituteVars(mapping, a)) };
  }
}

function applySubstEnv(subst: Substitution, env: TypeEnv): TypeEnv {
  const result = new Map<string, Scheme>();
  for (const [k, s] of env) {
    result.set(k, { vars: s.vars, type: applySubst(subst, s.type) });
  }
  return result;
}

let _source: string | undefined;

function typeError(msg: string, span: Span): Error {
  if (_source) return new RillError(msg, span, _source);
  return new TypeError(msg);
}

export function infer(expr: Expr, env?: TypeEnv, source?: string): Type {
  _source = source;
  const defaultEnv: TypeEnv = env ?? new Map();
  const [type, subst] = inferExpr(expr, defaultEnv, new Map());
  return applySubst(subst, type);
}

function withSpan<T>(fn: () => T, span: Span): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof TypeError && _source) {
      throw new RillError(e.message, span, _source);
    }
    throw e;
  }
}

function inferExpr(expr: Expr, env: TypeEnv, subst: Substitution): [Type, Substitution] {
  switch (expr.kind) {
    case "IntLit": return [{ kind: "TCon", name: "Int" }, subst];
    case "FloatLit": return [{ kind: "TCon", name: "Float" }, subst];
    case "StringLit": return [{ kind: "TCon", name: "String" }, subst];
    case "BoolLit": return [{ kind: "TCon", name: "Bool" }, subst];
    case "UnitLit": return [{ kind: "TCon", name: "Unit" }, subst];

    case "Ident": {
      const scheme = env.get(expr.name);
      if (!scheme) throw new TypeError(`Undefined variable: ${expr.name}`);
      return [instantiate(scheme), subst];
    }

    case "BinOp": {
      const [leftT, s1] = inferExpr(expr.left, env, subst);
      const [rightT, s2] = inferExpr(expr.right, env, s1);
      return withSpan(() => inferBinOp(expr.op, leftT, rightT, s2), expr.span);
    }

    case "UnaryOp": {
      const [operandT, s1] = inferExpr(expr.expr, env, subst);
      if (expr.op === "!") {
        const s2 = unify(operandT, { kind: "TCon", name: "Bool" }, s1);
        return [{ kind: "TCon", name: "Bool" }, s2];
      }
      if (expr.op === "-") {
        // Could be Int or Float — use a fresh var constrained later
        // For simplicity, try Int first
        try {
          const s2 = unify(operandT, { kind: "TCon", name: "Int" }, s1);
          return [{ kind: "TCon", name: "Int" }, s2];
        } catch {
          const s2 = unify(operandT, { kind: "TCon", name: "Float" }, s1);
          return [{ kind: "TCon", name: "Float" }, s2];
        }
      }
      throw new TypeError(`Unknown unary op: ${expr.op}`);
    }

    case "Let": {
      const [valT, s1] = inferExpr(expr.value, env, subst);
      const scheme = expr.rec ? mono(valT) : generalize(env, valT, s1);
      const newEnv = new Map(env);
      newEnv.set(expr.name, scheme);
      return inferExpr(expr.body, newEnv, s1);
    }

    case "Fn": {
      const paramT = freshTypeVar();
      const newEnv = new Map(env);
      newEnv.set(expr.param, mono(paramT));
      const [bodyT, s1] = inferExpr(expr.body, newEnv, subst);
      return [{ kind: "TFn", param: applySubst(s1, paramT), ret: bodyT }, s1];
    }

    case "Call": {
      const [fnT, s1] = inferExpr(expr.fn, env, subst);
      const [argT, s2] = inferExpr(expr.arg, env, s1);
      const retT = freshTypeVar();
      const s3 = withSpan(() => unify(applySubst(s2, fnT), { kind: "TFn", param: argT, ret: retT }, s2), expr.span);
      return [applySubst(s3, retT), s3];
    }

    case "If": {
      const [condT, s1] = inferExpr(expr.cond, env, subst);
      const s2 = unify(condT, { kind: "TCon", name: "Bool" }, s1);
      const [thenT, s3] = inferExpr(expr.then, env, s2);
      const [elseT, s4] = inferExpr(expr.else_, env, s3);
      const s5 = unify(thenT, elseT, s4);
      return [applySubst(s5, thenT), s5];
    }

    case "List": {
      if (expr.elements.length === 0) {
        return [{ kind: "TList", element: freshTypeVar() }, subst];
      }
      let s = subst;
      const [firstT, s1] = inferExpr(expr.elements[0], env, s);
      s = s1;
      for (let i = 1; i < expr.elements.length; i++) {
        const [elT, si] = inferExpr(expr.elements[i], env, s);
        s = unify(firstT, elT, si);
      }
      return [{ kind: "TList", element: applySubst(s, firstT) }, s];
    }

    case "Tuple": {
      let s = subst;
      const types: Type[] = [];
      for (const el of expr.elements) {
        const [t, si] = inferExpr(el, env, s);
        types.push(t);
        s = si;
      }
      return [{ kind: "TTuple", elements: types }, s];
    }

    case "Record": {
      let s = subst;
      const fields = new Map<string, Type>();
      for (const f of expr.fields) {
        const [t, si] = inferExpr(f.value, env, s);
        fields.set(f.name, t);
        s = si;
      }
      return [{ kind: "TRecord", fields, rest: null }, s];
    }

    case "FieldAccess": {
      const [recT, s1] = inferExpr(expr.expr, env, subst);
      const resolved = applySubst(s1, recT);
      if (resolved.kind === "TRecord") {
        const fieldT = resolved.fields.get(expr.field);
        if (fieldT) return [fieldT, s1];
        // Field absent. If the record is OPEN, grow its row to include the field.
        if (resolved.rest !== null) {
          const grownField = freshTypeVar();
          const constraint: Type = {
            kind: "TRecord",
            fields: new Map([[expr.field, grownField]]),
            rest: freshTypeVar(),
          };
          const s2 = unify(resolved, constraint, s1);
          return [applySubst(s2, grownField), s2];
        }
        // CLOSED record and field is missing → reject, with a source-located error.
        throw typeError(`No field ${expr.field} in record`, expr.span);
      }
      if (resolved.kind === "TVar") {
        // Create a record type constraint with the accessed field
        const fieldT = freshTypeVar();
        const recType: Type = {
          kind: "TRecord",
          fields: new Map([[expr.field, fieldT]]),
          rest: freshTypeVar(),
        };
        const s2 = unify(resolved, recType, s1);
        return [applySubst(s2, fieldT), s2];
      }
      throw new TypeError(`Field access on non-record type: ${resolved.kind}`);
    }

    case "Tag": {
      let s = subst;
      const argTypes: Type[] = [];
      for (const a of expr.args) {
        const [t, si] = inferExpr(a, env, s);
        argTypes.push(t);
        s = si;
      }
      if (expr.tag === "Ok" && argTypes.length === 1) {
        return [{ kind: "TResult", ok: argTypes[0] }, s];
      }
      if (expr.tag === "Err" && argTypes.length === 1) {
        return [{ kind: "TResult", ok: freshTypeVar() }, s];
      }
      return [{ kind: "TTag", tag: expr.tag, args: argTypes }, s];
    }

    case "Pipe": {
      // a |> f desugars to f(a) for type checking
      const [leftT, s1] = inferExpr(expr.left, env, subst);
      if (expr.right.kind === "Catch") {
        // catch unwraps Result: if leftT is Result(T), return T unified with fallback
        const okT = freshTypeVar();
        const s2 = unify(applySubst(s1, leftT), { kind: "TResult", ok: okT }, s1);
        const catchEnv = new Map(env);
        catchEnv.set(expr.right.errorName, mono({ kind: "TCon", name: "String" }));
        const [fallbackT, s3] = inferExpr(expr.right.fallback, catchEnv, s2);
        const s4 = unify(applySubst(s3, okT), fallbackT, s3);
        return [applySubst(s4, okT), s4];
      }
      // Special handling: if right side is Try, apply inner fn first then try
      if (expr.right.kind === "Try") {
        const [fnT, s2] = inferExpr(expr.right.expr, env, s1);
        const callRetT = freshTypeVar();
        const s3 = unify(applySubst(s2, fnT), { kind: "TFn", param: applySubst(s2, leftT), ret: callRetT }, s2);
        const okT = freshTypeVar();
        const s4 = unify(applySubst(s3, callRetT), { kind: "TResult", ok: okT }, s3);
        return [applySubst(s4, okT), s4];
      }
      const [rightT, s2] = inferExpr(expr.right, env, s1);
      const retT = freshTypeVar();
      const s3 = unify(applySubst(s2, rightT), { kind: "TFn", param: applySubst(s2, leftT), ret: retT }, s2);
      return [applySubst(s3, retT), s3];
    }

    case "Match": {
      const [subjT, s1] = inferExpr(expr.subject, env, subst);
      let s = s1;
      const retT = freshTypeVar();
      for (const c of expr.cases) {
        const [patT, patBindings, s2] = inferPattern(c.pattern, s);
        // Skip subject-pattern unification for tag patterns (no sum types in v1)
        if (patT.kind === "TTag") {
          s = s2;
        } else {
          try {
            s = unify(applySubst(s2, subjT), patT, s2);
          } catch {
            s = s2;
          }
        }
        const matchEnv = new Map(env);
        for (const [k, t] of patBindings) matchEnv.set(k, mono(t));
        const [bodyT, s3] = inferExpr(c.body, matchEnv, s);
        s = unify(retT, bodyT, s3);
      }
      return [applySubst(s, retT), s];
    }

    case "Try": {
      const [exprT, s1] = inferExpr(expr.expr, env, subst);
      const okT = freshTypeVar();
      const resolvedExprT = applySubst(s1, exprT);
      try {
        const s2 = unify(resolvedExprT, { kind: "TResult", ok: okT }, s1);
        return [applySubst(s2, okT), s2];
      } catch {
        throw typeError(`The ? operator requires a Result type, but got ${prettyType(resolvedExprT)}`, expr.span);
      }
    }

    case "Catch": {
      const [exprT, s1] = inferExpr(expr.expr, env, subst);
      const newEnv = new Map(env);
      newEnv.set(expr.errorName, mono({ kind: "TCon", name: "String" }));
      const [fallbackT, s2] = inferExpr(expr.fallback, newEnv, s1);
      // Result: either the ok type or the fallback type
      return [fallbackT, s2];
    }

    default:
      throw new TypeError(`Cannot type-check ${(expr as any).kind} yet`);
  }
}

function inferBinOp(op: string, leftT: Type, rightT: Type, subst: Substitution): [Type, Substitution] {
  // Arithmetic operators: both sides same numeric type, return same type
  if (["+", "-", "*", "/", "%"].includes(op)) {
    const s1 = unify(leftT, rightT, subst);
    // Result type is same as operand type
    return [applySubst(s1, leftT), s1];
  }

  // Comparison operators: both sides same type, return Bool
  if (["==", "!=", "<", ">", "<=", ">="].includes(op)) {
    const s1 = unify(leftT, rightT, subst);
    return [{ kind: "TCon", name: "Bool" }, s1];
  }

  // String concatenation
  if (op === "++") {
    const s1 = unify(leftT, { kind: "TCon", name: "String" }, subst);
    const s2 = unify(rightT, { kind: "TCon", name: "String" }, s1);
    return [{ kind: "TCon", name: "String" }, s2];
  }

  // Boolean operators
  if (op === "&&" || op === "||") {
    const s1 = unify(leftT, { kind: "TCon", name: "Bool" }, subst);
    const s2 = unify(rightT, { kind: "TCon", name: "Bool" }, s1);
    return [{ kind: "TCon", name: "Bool" }, s2];
  }

  throw new TypeError(`Unknown operator: ${op}`);
}

function inferPattern(pattern: import("./ast").Pattern, subst: Substitution): [Type, Map<string, Type>, Substitution] {
  switch (pattern.kind) {
    case "IntPat": return [{ kind: "TCon", name: "Int" }, new Map(), subst];
    case "FloatPat": return [{ kind: "TCon", name: "Float" }, new Map(), subst];
    case "StringPat": return [{ kind: "TCon", name: "String" }, new Map(), subst];
    case "BoolPat": return [{ kind: "TCon", name: "Bool" }, new Map(), subst];
    case "WildcardPat": return [freshTypeVar(), new Map(), subst];
    case "IdentPat": {
      const t = freshTypeVar();
      return [t, new Map([[pattern.name, t]]), subst];
    }
    case "TagPat": {
      let s = subst;
      const argTypes: Type[] = [];
      const bindings = new Map<string, Type>();
      for (const arg of pattern.args) {
        const [t, b, si] = inferPattern(arg, s);
        argTypes.push(t);
        for (const [k, v] of b) bindings.set(k, v);
        s = si;
      }
      if (pattern.tag === "Ok" && argTypes.length === 1) {
        return [{ kind: "TResult", ok: argTypes[0] }, bindings, s];
      }
      if (pattern.tag === "Err" && argTypes.length === 1) {
        return [{ kind: "TResult", ok: freshTypeVar() }, bindings, s];
      }
      return [{ kind: "TTag", tag: pattern.tag, args: argTypes }, bindings, s];
    }
    case "TuplePat": {
      let s = subst;
      const types: Type[] = [];
      const bindings = new Map<string, Type>();
      for (const el of pattern.elements) {
        const [t, b, si] = inferPattern(el, s);
        types.push(t);
        for (const [k, v] of b) bindings.set(k, v);
        s = si;
      }
      return [{ kind: "TTuple", elements: types }, bindings, s];
    }
    case "RecordPat": {
      let s = subst;
      const fields = new Map<string, Type>();
      const bindings = new Map<string, Type>();
      for (const f of pattern.fields) {
        const [t, b, si] = inferPattern(f.pattern, s);
        fields.set(f.name, t);
        for (const [k, v] of b) bindings.set(k, v);
        s = si;
      }
      return [{ kind: "TRecord", fields, rest: freshTypeVar() }, bindings, s];
    }
  }
}

export function createPreludeTypeEnv(): TypeEnv {
  const env: TypeEnv = new Map();

  const tcon = (name: string): Type => ({ kind: "TCon", name });
  const tlist = (element: Type): Type => ({ kind: "TList", element });
  const ttuple = (...elements: Type[]): Type => ({ kind: "TTuple", elements });
  const tresult = (ok: Type): Type => ({ kind: "TResult", ok });
  // Curried arrow: tfn(A, B, C) === A -> B -> C
  const tfn = (...ts: Type[]): Type =>
    ts.reduceRight((ret, param) => ({ kind: "TFn", param, ret }));
  // Quantify ALL free vars of `t` (empty env → generalizes everything).
  const scheme = (t: Type): Scheme => generalize(new Map(), t, new Map());

  const Int = tcon("Int");
  const Str = tcon("String");
  const Bool = tcon("Bool");
  const Unit = tcon("Unit");

  // map : (a -> b) -> List(a) -> List(b)
  {
    const a = freshTypeVar(), b = freshTypeVar();
    env.set("map", scheme(tfn(tfn(a, b), tlist(a), tlist(b))));
  }
  // filter : (a -> Bool) -> List(a) -> List(a)
  {
    const a = freshTypeVar();
    env.set("filter", scheme(tfn(tfn(a, Bool), tlist(a), tlist(a))));
  }
  // fold : b -> (b -> a -> b) -> List(a) -> b
  {
    const a = freshTypeVar(), b = freshTypeVar();
    env.set("fold", scheme(tfn(b, tfn(b, a, b), tlist(a), b)));
  }
  // each : (a -> Unit) -> List(a) -> Unit
  {
    const a = freshTypeVar();
    env.set("each", scheme(tfn(tfn(a, Unit), tlist(a), Unit)));
  }
  // length : List(a) -> Int
  {
    const a = freshTypeVar();
    env.set("length", scheme(tfn(tlist(a), Int)));
  }
  // str_len : String -> Int
  env.set("str_len", scheme(tfn(Str, Int)));
  // head : List(a) -> Result(a)
  {
    const a = freshTypeVar();
    env.set("head", scheme(tfn(tlist(a), tresult(a))));
  }
  // tail : List(a) -> Result(List(a))
  {
    const a = freshTypeVar();
    env.set("tail", scheme(tfn(tlist(a), tresult(tlist(a)))));
  }
  // concat : String -> String -> String
  env.set("concat", scheme(tfn(Str, Str, Str)));
  // to_string : a -> String
  {
    const a = freshTypeVar();
    env.set("to_string", scheme(tfn(a, Str)));
  }
  // print : a -> Unit
  {
    const a = freshTypeVar();
    env.set("print", scheme(tfn(a, Unit)));
  }
  // count : (a -> Bool) -> List(a) -> Int
  {
    const a = freshTypeVar();
    env.set("count", scheme(tfn(tfn(a, Bool), tlist(a), Int)));
  }
  // contains : a -> List(a) -> Bool
  {
    const a = freshTypeVar();
    env.set("contains", scheme(tfn(a, tlist(a), Bool)));
  }
  // one_of : a -> List(a) -> Bool (alias of contains)
  {
    const a = freshTypeVar();
    env.set("one_of", scheme(tfn(a, tlist(a), Bool)));
  }
  // lookup : k -> List((k, v)) -> Result(v)
  {
    const k = freshTypeVar(), v = freshTypeVar();
    env.set("lookup", scheme(tfn(k, tlist(ttuple(k, v)), tresult(v))));
  }
  // require : Bool -> String -> Result(Unit)
  env.set("require", scheme(tfn(Bool, Str, tresult(Unit))));

  return env;
}

// Bind a concrete (monomorphic) input type under `name` in a copy of `env`.
// Used by embedders to declare rule input signatures. Does not generalize:
// the signature type is fixed, not polymorphic.
export function bindType(env: TypeEnv, name: string, t: Type): TypeEnv {
  const next = new Map(env);
  next.set(name, mono(t));
  return next;
}
