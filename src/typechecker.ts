import { Expr } from "./ast";
import { Type, freshTypeVar, prettyType } from "./types";
import { Substitution, unify, applySubst } from "./unify";
import { RillError } from "./errors";
import { Span } from "./span";
import { DeclEnv, createPreludeDeclEnv, instantiateCtor, suggestName } from "./decls";

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
    case "TUnion": return t.args.reduce((s, a) => union(s, freeVars(a)), new Set<number>());
    case "TParam": return new Set();
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
    case "TUnion": return { kind: "TUnion", name: t.name, args: t.args.map(a => substituteVars(mapping, a)) };
    case "TParam": return t;
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

export function infer(expr: Expr, env?: TypeEnv, source?: string, declEnv?: DeclEnv): Type {
  _source = source;
  const defaultEnv: TypeEnv = env ?? new Map();
  const defaultDeclEnv: DeclEnv = declEnv ?? createPreludeDeclEnv();
  const [type, subst] = inferExpr(expr, defaultEnv, new Map(), defaultDeclEnv);
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

function inferExpr(expr: Expr, env: TypeEnv, subst: Substitution, declEnv: DeclEnv): [Type, Substitution] {
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
      const [leftT, s1] = inferExpr(expr.left, env, subst, declEnv);
      const [rightT, s2] = inferExpr(expr.right, env, s1, declEnv);
      return withSpan(() => inferBinOp(expr.op, leftT, rightT, s2), expr.span);
    }

    case "UnaryOp": {
      const [operandT, s1] = inferExpr(expr.expr, env, subst, declEnv);
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
      const [valT, s1] = inferExpr(expr.value, env, subst, declEnv);
      const scheme = expr.rec ? mono(valT) : generalize(env, valT, s1);
      const newEnv = new Map(env);
      newEnv.set(expr.name, scheme);
      return inferExpr(expr.body, newEnv, s1, declEnv);
    }

    case "Fn": {
      const paramT = freshTypeVar();
      const newEnv = new Map(env);
      newEnv.set(expr.param, mono(paramT));
      const [bodyT, s1] = inferExpr(expr.body, newEnv, subst, declEnv);
      return [{ kind: "TFn", param: applySubst(s1, paramT), ret: bodyT }, s1];
    }

    case "Call": {
      const [fnT, s1] = inferExpr(expr.fn, env, subst, declEnv);
      const [argT, s2] = inferExpr(expr.arg, env, s1, declEnv);
      const retT = freshTypeVar();
      const s3 = withSpan(() => unify(applySubst(s2, fnT), { kind: "TFn", param: argT, ret: retT }, s2), expr.span);
      return [applySubst(s3, retT), s3];
    }

    case "If": {
      const [condT, s1] = inferExpr(expr.cond, env, subst, declEnv);
      const s2 = unify(condT, { kind: "TCon", name: "Bool" }, s1);
      const [thenT, s3] = inferExpr(expr.then, env, s2, declEnv);
      const [elseT, s4] = inferExpr(expr.else_, env, s3, declEnv);
      const s5 = unify(thenT, elseT, s4);
      return [applySubst(s5, thenT), s5];
    }

    case "List": {
      if (expr.elements.length === 0) {
        return [{ kind: "TList", element: freshTypeVar() }, subst];
      }
      let s = subst;
      const [firstT, s1] = inferExpr(expr.elements[0], env, s, declEnv);
      s = s1;
      for (let i = 1; i < expr.elements.length; i++) {
        const [elT, si] = inferExpr(expr.elements[i], env, s, declEnv);
        s = unify(firstT, elT, si);
      }
      return [{ kind: "TList", element: applySubst(s, firstT) }, s];
    }

    case "Tuple": {
      let s = subst;
      const types: Type[] = [];
      for (const el of expr.elements) {
        const [t, si] = inferExpr(el, env, s, declEnv);
        types.push(t);
        s = si;
      }
      return [{ kind: "TTuple", elements: types }, s];
    }

    case "Record": {
      let s = subst;
      const fields = new Map<string, Type>();
      for (const f of expr.fields) {
        const [t, si] = inferExpr(f.value, env, s, declEnv);
        fields.set(f.name, t);
        s = si;
      }
      return [{ kind: "TRecord", fields, rest: null }, s];
    }

    case "FieldAccess": {
      const [recT, s1] = inferExpr(expr.expr, env, subst, declEnv);
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
        const [t, si] = inferExpr(a, env, s, declEnv);
        argTypes.push(t);
        s = si;
      }

      // Look up constructor in declEnv
      const ctorInfo = declEnv.ctors.get(expr.tag);
      if (!ctorInfo) {
        // Unknown constructor - error with did-you-mean
        const suggestion = suggestName(expr.tag, declEnv.ctors.keys());
        const suggestionText = suggestion ? ` (did you mean ${suggestion}?)` : "";
        throw typeError(`Unknown constructor: ${expr.tag}${suggestionText}`, expr.span);
      }

      // Instantiate the constructor
      const { unionType, payload } = instantiateCtor(ctorInfo, declEnv);

      // Check arity
      const expectedArity = payload === null ? 0 : 1;
      if (argTypes.length !== expectedArity) {
        throw typeError(
          `Constructor ${expr.tag} expects ${expectedArity} arguments, got ${argTypes.length}`,
          expr.span
        );
      }

      // Unify argument type with payload if needed
      if (payload !== null && argTypes.length === 1) {
        s = unify(argTypes[0], payload, s);
      }

      return [unionType, s];
    }

    case "Pipe": {
      // a |> f desugars to f(a) for type checking
      const [leftT, s1] = inferExpr(expr.left, env, subst, declEnv);
      if (expr.right.kind === "Catch") {
        // catch unwraps Result: if leftT is Result(T), return T unified with fallback
        const okT = freshTypeVar();
        const resultType: Type = { kind: "TUnion", name: "Result", args: [okT] };
        const s2 = unify(applySubst(s1, leftT), resultType, s1);
        const catchEnv = new Map(env);
        catchEnv.set(expr.right.errorName, mono({ kind: "TCon", name: "String" }));
        const [fallbackT, s3] = inferExpr(expr.right.fallback, catchEnv, s2, declEnv);
        const s4 = unify(applySubst(s3, okT), fallbackT, s3);
        return [applySubst(s4, okT), s4];
      }
      // Special handling: if right side is Try, apply inner fn first then try
      if (expr.right.kind === "Try") {
        const [fnT, s2] = inferExpr(expr.right.expr, env, s1, declEnv);
        const callRetT = freshTypeVar();
        const s3 = unify(applySubst(s2, fnT), { kind: "TFn", param: applySubst(s2, leftT), ret: callRetT }, s2);
        const okT = freshTypeVar();
        const resultType: Type = { kind: "TUnion", name: "Result", args: [okT] };
        const s4 = unify(applySubst(s3, callRetT), resultType, s3);
        return [applySubst(s4, okT), s4];
      }
      const [rightT, s2] = inferExpr(expr.right, env, s1, declEnv);
      const retT = freshTypeVar();
      const s3 = unify(applySubst(s2, rightT), { kind: "TFn", param: applySubst(s2, leftT), ret: retT }, s2);
      return [applySubst(s3, retT), s3];
    }

    case "Match": {
      const [subjT, s1] = inferExpr(expr.subject, env, subst, declEnv);
      let s = s1;
      const retT = freshTypeVar();
      for (const c of expr.cases) {
        const [patT, patBindings, s2] = inferPattern(c.pattern, s, declEnv);
        // Unify subject with pattern type
        try {
          s = unify(applySubst(s2, subjT), patT, s2);
        } catch {
          s = s2;
        }
        const matchEnv = new Map(env);
        for (const [k, t] of patBindings) matchEnv.set(k, mono(t));
        const [bodyT, s3] = inferExpr(c.body, matchEnv, s, declEnv);
        s = unify(retT, bodyT, s3);
      }
      return [applySubst(s, retT), s];
    }

    case "Try": {
      const [exprT, s1] = inferExpr(expr.expr, env, subst, declEnv);
      const okT = freshTypeVar();
      const resultType: Type = { kind: "TUnion", name: "Result", args: [okT] };
      const resolvedExprT = applySubst(s1, exprT);
      try {
        const s2 = unify(resolvedExprT, resultType, s1);
        return [applySubst(s2, okT), s2];
      } catch {
        throw typeError(`The ? operator requires a Result type, but got ${prettyType(resolvedExprT)}`, expr.span);
      }
    }

    case "Catch": {
      const [exprT, s1] = inferExpr(expr.expr, env, subst, declEnv);
      const newEnv = new Map(env);
      newEnv.set(expr.errorName, mono({ kind: "TCon", name: "String" }));
      const [fallbackT, s2] = inferExpr(expr.fallback, newEnv, s1, declEnv);
      // Result: either the ok type or the fallback type
      return [fallbackT, s2];
    }

    default:
      throw new TypeError(`Cannot type-check ${(expr as any).kind} yet`);
  }
}

function isNumericType(t: Type): boolean {
  return t.kind === "TCon" && (t.name === "Int" || t.name === "Float");
}

function containsFnType(t: Type): boolean {
  switch (t.kind) {
    case "TFn": return true;
    case "TVar":
    case "TCon":
    case "TParam": return false;
    case "TList": return containsFnType(t.element);
    case "TTuple": return t.elements.some(containsFnType);
    case "TRecord": {
      for (const v of t.fields.values()) if (containsFnType(v)) return true;
      return t.rest ? containsFnType(t.rest) : false;
    }
    case "TUnion": return t.args.some(containsFnType);
  }
}

function inferBinOp(op: string, leftT: Type, rightT: Type, subst: Substitution): [Type, Substitution] {
  // Arithmetic operators: both sides same numeric type (Int or Float), return same type
  if (["+", "-", "*", "/", "%"].includes(op)) {
    const s1 = unify(leftT, rightT, subst);
    // Constrain the operand type to Int or Float (Int first, matching unary minus)
    try {
      const s2 = unify(applySubst(s1, leftT), { kind: "TCon", name: "Int" }, s1);
      return [{ kind: "TCon", name: "Int" }, s2];
    } catch {
      try {
        const s2 = unify(applySubst(s1, leftT), { kind: "TCon", name: "Float" }, s1);
        return [{ kind: "TCon", name: "Float" }, s2];
      } catch {
        throw new TypeError(`Operator ${op} requires Int or Float operands, got ${prettyType(applySubst(s1, leftT))}`);
      }
    }
  }

  // Equality: any non-function type; Int and Float may mix
  if (op === "==" || op === "!=") {
    if (isNumericType(applySubst(subst, leftT)) && isNumericType(applySubst(subst, rightT))) {
      return [{ kind: "TCon", name: "Bool" }, subst];
    }
    const s1 = unify(leftT, rightT, subst);
    if (containsFnType(applySubst(s1, leftT))) {
      throw new TypeError(`Operator ${op} cannot compare functions`);
    }
    return [{ kind: "TCon", name: "Bool" }, s1];
  }

  // Ordering: Int, Float, or String; Int and Float may mix
  if (["<", ">", "<=", ">="].includes(op)) {
    if (isNumericType(applySubst(subst, leftT)) && isNumericType(applySubst(subst, rightT))) {
      return [{ kind: "TCon", name: "Bool" }, subst];
    }
    const s1 = unify(leftT, rightT, subst);
    const resolved = applySubst(s1, leftT);
    if (resolved.kind === "TVar") {
      // Unconstrained operands default to Int (matching unary minus)
      const s2 = unify(resolved, { kind: "TCon", name: "Int" }, s1);
      return [{ kind: "TCon", name: "Bool" }, s2];
    }
    if (isNumericType(resolved) || (resolved.kind === "TCon" && resolved.name === "String")) {
      return [{ kind: "TCon", name: "Bool" }, s1];
    }
    throw new TypeError(`Operator ${op} requires Int, Float, or String operands, got ${prettyType(resolved)}`);
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

function inferPattern(pattern: import("./ast").Pattern, subst: Substitution, declEnv: DeclEnv): [Type, Map<string, Type>, Substitution] {
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
      // Look up constructor in declEnv
      const ctorInfo = declEnv.ctors.get(pattern.tag);
      if (!ctorInfo) {
        // Unknown constructor - error with did-you-mean
        const suggestion = suggestName(pattern.tag, declEnv.ctors.keys());
        const suggestionText = suggestion ? ` (did you mean ${suggestion}?)` : "";
        throw new TypeError(`Unknown constructor in pattern: ${pattern.tag}${suggestionText}`);
      }

      // Instantiate the constructor
      const { unionType, payload } = instantiateCtor(ctorInfo, declEnv);

      // Check arity
      const expectedArity = payload === null ? 0 : 1;
      if (pattern.args.length !== expectedArity) {
        throw new TypeError(
          `Constructor ${pattern.tag} expects ${expectedArity} arguments, got ${pattern.args.length}`
        );
      }

      // Infer pattern args and bind variables
      let s = subst;
      const bindings = new Map<string, Type>();
      if (pattern.args.length === 1 && payload !== null) {
        // Infer the single argument pattern against the instantiated payload
        const [argPatT, argBindings, si] = inferPattern(pattern.args[0], s, declEnv);
        s = unify(argPatT, payload, si);
        for (const [k, v] of argBindings) bindings.set(k, v);
      }

      return [unionType, bindings, s];
    }
    case "TuplePat": {
      let s = subst;
      const types: Type[] = [];
      const bindings = new Map<string, Type>();
      for (const el of pattern.elements) {
        const [t, b, si] = inferPattern(el, s, declEnv);
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
        const [t, b, si] = inferPattern(f.pattern, s, declEnv);
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
  const tunion = (name: string, args: Type[] = []): Type => ({ kind: "TUnion", name, args });
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
    env.set("head", scheme(tfn(tlist(a), tunion("Result", [a]))));
  }
  // tail : List(a) -> Result(List(a))
  {
    const a = freshTypeVar();
    env.set("tail", scheme(tfn(tlist(a), tunion("Result", [tlist(a)]))));
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
    env.set("lookup", scheme(tfn(k, tlist(ttuple(k, v)), tunion("Result", [v]))));
  }
  // require : Bool -> String -> Result(Unit)
  env.set("require", scheme(tfn(Bool, Str, tunion("Result", [Unit]))));

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
