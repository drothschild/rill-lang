import { Expr } from "./ast";
import { Value } from "./values";
import { Span, formatSpan } from "./span";

class EarlyReturn {
  constructor(public value: Value) {}
}

export function evaluate(expr: Expr, env: Map<string, Value> = new Map()): Value {
  try {
    return evalExpr(expr, env);
  } catch (e) {
    if (e instanceof EarlyReturn) return e.value;
    throw e;
  }
}

function evalExpr(expr: Expr, env: Map<string, Value>): Value {
  switch (expr.kind) {
    case "IntLit":
      return { kind: "Int", value: expr.value };
    case "FloatLit":
      return { kind: "Float", value: expr.value };
    case "StringLit":
      return { kind: "String", value: expr.value };
    case "BoolLit":
      return { kind: "Bool", value: expr.value };
    case "UnitLit":
      return { kind: "Unit" };

    case "Ident": {
      const val = env.get(expr.name);
      if (val === undefined) throw new Error(`Undefined variable: ${expr.name}`);
      return val;
    }

    case "BinOp": {
      // && and || short-circuit: only evaluate the right side when needed
      if (expr.op === "&&" || expr.op === "||") {
        const left = evalExpr(expr.left, env);
        if (left.kind !== "Bool") throw new Error(`Cannot apply operator ${expr.op} to ${left.kind}`);
        if (expr.op === "&&" && !left.value) return { kind: "Bool", value: false };
        if (expr.op === "||" && left.value) return { kind: "Bool", value: true };
        const right = evalExpr(expr.right, env);
        if (right.kind !== "Bool") throw new Error(`Cannot apply operator ${expr.op} to ${right.kind}`);
        return right;
      }
      const left = evalExpr(expr.left, env);
      const right = evalExpr(expr.right, env);
      return evalBinOp(expr.op, left, right, expr.span);
    }

    case "UnaryOp": {
      const operand = evalExpr(expr.expr, env);
      return evalUnaryOp(expr.op, operand);
    }

    case "Let": {
      const value = evalExpr(expr.value, env);
      const newEnv = new Map(env);
      if (expr.rec && value.kind === "Closure") {
        const recEnv = new Map(value.env);
        recEnv.set(expr.name, value);
        value.env = recEnv;
      }
      newEnv.set(expr.name, value);
      return evalExpr(expr.body, newEnv);
    }

    case "Fn":
      return { kind: "Closure", param: expr.param, body: expr.body, env: new Map(env) };

    case "Call": {
      const fn = evalExpr(expr.fn, env);
      const arg = evalExpr(expr.arg, env);
      return applyFn(fn, arg);
    }

    case "Match": {
      const subject = evalExpr(expr.subject, env);
      for (const c of expr.cases) {
        const bindings = matchPattern(c.pattern, subject);
        if (bindings !== null) {
          const matchEnv = new Map(env);
          for (const [k, v] of bindings) matchEnv.set(k, v);
          return evalExpr(c.body, matchEnv);
        }
      }
      throw new Error("No matching pattern");
    }

    case "Try": {
      const val = evalExpr(expr.expr, env);
      if (val.kind === "Tag" && val.tag === "Ok" && val.args.length === 1) {
        return val.args[0];
      }
      if (val.kind === "Tag" && val.tag === "Err") {
        throw new EarlyReturn(val);
      }
      throw new Error("? operator requires Ok(...) or Err(...)");
    }

    case "Catch": {
      try {
        const val = evalExpr(expr.expr, env);
        if (val.kind === "Tag" && val.tag === "Ok" && val.args.length === 1) {
          return val.args[0];
        }
        if (val.kind === "Tag" && val.tag === "Err" && val.args.length >= 1) {
          const catchEnv = new Map(env);
          catchEnv.set(expr.errorName, val.args[0]);
          return evalExpr(expr.fallback, catchEnv);
        }
        return val;
      } catch (e) {
        if (e instanceof EarlyReturn) {
          if (e.value.kind === "Tag" && e.value.tag === "Err" && e.value.args.length >= 1) {
            const catchEnv = new Map(env);
            catchEnv.set(expr.errorName, e.value.args[0]);
            return evalExpr(expr.fallback, catchEnv);
          }
          return e.value;
        }
        throw e;
      }
    }

    case "Pipe": {
      // Special handling: if right side is a Catch, fill in the left as expr
      if (expr.right.kind === "Catch") {
        const catchExpr: import("./ast").Catch = {
          ...expr.right,
          expr: expr.left,
        };
        return evalExpr(catchExpr, env);
      }
      // Special handling: if right side is Try, apply inner fn first then try
      if (expr.right.kind === "Try") {
        const left = evalExpr(expr.left, env);
        const fn = evalExpr(expr.right.expr, env);
        const result = applyFn(fn, left);
        if (result.kind === "Tag" && result.tag === "Ok" && result.args.length === 1) {
          return result.args[0];
        }
        if (result.kind === "Tag" && result.tag === "Err") {
          throw new EarlyReturn(result);
        }
        throw new Error("? operator requires Ok(...) or Err(...)");
      }
      const left = evalExpr(expr.left, env);
      const right = evalExpr(expr.right, env);
      return applyFn(right, left);
    }

    case "List":
      return { kind: "List", elements: expr.elements.map(e => evalExpr(e, env)) };

    case "Tuple":
      return { kind: "Tuple", elements: expr.elements.map(e => evalExpr(e, env)) };

    case "Record": {
      const fields = new Map<string, Value>();
      for (const f of expr.fields) {
        fields.set(f.name, evalExpr(f.value, env));
      }
      return { kind: "Record", fields };
    }

    case "FieldAccess": {
      const record = evalExpr(expr.expr, env);
      if (record.kind !== "Record") throw new Error("Field access on non-record");
      const val = record.fields.get(expr.field);
      if (val === undefined) throw new Error(`No field ${expr.field}`);
      return val;
    }

    case "Tag":
      return { kind: "Tag", tag: expr.tag, args: expr.args.map(a => evalExpr(a, env)) };

    case "If": {
      const cond = evalExpr(expr.cond, env);
      if (cond.kind !== "Bool") throw new Error("If condition must be Bool");
      return cond.value ? evalExpr(expr.then, env) : evalExpr(expr.else_, env);
    }

    default:
      throw new Error(`Cannot evaluate ${(expr as any).kind} yet`);
  }
}

export function applyFn(fn: Value, arg: Value): Value {
  if (fn.kind === "Closure") {
    const newEnv = new Map(fn.env);
    newEnv.set(fn.param, arg);
    return evalExpr(fn.body, newEnv);
  }
  if (fn.kind === "BuiltinFn") {
    const applied = [...fn.applied, arg];
    if (applied.length >= fn.arity) {
      return fn.fn(applied);
    }
    return { kind: "BuiltinFn", name: fn.name, arity: fn.arity, applied, fn: fn.fn };
  }
  throw new Error(`Cannot call ${fn.kind}`);
}

function matchPattern(pattern: import("./ast").Pattern, value: Value): Map<string, Value> | null {
  switch (pattern.kind) {
    case "IntPat":
      return value.kind === "Int" && value.value === pattern.value ? new Map() : null;
    case "FloatPat":
      return value.kind === "Float" && value.value === pattern.value ? new Map() : null;
    case "StringPat":
      return value.kind === "String" && value.value === pattern.value ? new Map() : null;
    case "BoolPat":
      return value.kind === "Bool" && value.value === pattern.value ? new Map() : null;
    case "WildcardPat":
      return new Map();
    case "IdentPat":
      return new Map([[pattern.name, value]]);
    case "TagPat": {
      if (value.kind !== "Tag" || value.tag !== pattern.tag) return null;
      if (value.args.length !== pattern.args.length) return null;
      const bindings = new Map<string, Value>();
      for (let i = 0; i < pattern.args.length; i++) {
        const sub = matchPattern(pattern.args[i], value.args[i]);
        if (sub === null) return null;
        for (const [k, v] of sub) bindings.set(k, v);
      }
      return bindings;
    }
    case "TuplePat": {
      if (value.kind !== "Tuple" || value.elements.length !== pattern.elements.length) return null;
      const bindings = new Map<string, Value>();
      for (let i = 0; i < pattern.elements.length; i++) {
        const sub = matchPattern(pattern.elements[i], value.elements[i]);
        if (sub === null) return null;
        for (const [k, v] of sub) bindings.set(k, v);
      }
      return bindings;
    }
    case "RecordPat": {
      if (value.kind !== "Record") return null;
      const bindings = new Map<string, Value>();
      for (const field of pattern.fields) {
        const fieldVal = value.fields.get(field.name);
        if (fieldVal === undefined) return null;
        const sub = matchPattern(field.pattern, fieldVal);
        if (sub === null) return null;
        for (const [k, v] of sub) bindings.set(k, v);
      }
      return bindings;
    }
  }
}

function evalBinOp(op: string, left: Value, right: Value, span: Span): Value {
  // Equality: deep structural comparison over all value kinds
  if (op === "==" || op === "!=") {
    const equal = valueEquals(left, right);
    return { kind: "Bool", value: op === "==" ? equal : !equal };
  }

  // Arithmetic (Int)
  if (left.kind === "Int" && right.kind === "Int") {
    switch (op) {
      case "+": return { kind: "Int", value: left.value + right.value };
      case "-": return { kind: "Int", value: left.value - right.value };
      case "*": return { kind: "Int", value: left.value * right.value };
      case "/":
        if (right.value === 0) throw new Error(`Division by zero at ${formatSpan(span)}`);
        return { kind: "Int", value: Math.trunc(left.value / right.value) };
      case "%":
        if (right.value === 0) throw new Error(`Modulo by zero at ${formatSpan(span)}`);
        return { kind: "Int", value: left.value % right.value };
      case "<": return { kind: "Bool", value: left.value < right.value };
      case ">": return { kind: "Bool", value: left.value > right.value };
      case "<=": return { kind: "Bool", value: left.value <= right.value };
      case ">=": return { kind: "Bool", value: left.value >= right.value };
    }
  }

  // Arithmetic (Float)
  if (left.kind === "Float" && right.kind === "Float") {
    switch (op) {
      case "+": return { kind: "Float", value: left.value + right.value };
      case "-": return { kind: "Float", value: left.value - right.value };
      case "*": return { kind: "Float", value: left.value * right.value };
      case "/":
        if (right.value === 0) throw new Error(`Division by zero at ${formatSpan(span)}`);
        return { kind: "Float", value: left.value / right.value };
      case "%":
        if (right.value === 0) throw new Error(`Modulo by zero at ${formatSpan(span)}`);
        return { kind: "Float", value: left.value % right.value };
      case "<": return { kind: "Bool", value: left.value < right.value };
      case ">": return { kind: "Bool", value: left.value > right.value };
    }
  }

  // Mixed Int/Float
  if ((left.kind === "Int" || left.kind === "Float") && (right.kind === "Int" || right.kind === "Float")) {
    const l = left.value;
    const r = right.value;
    switch (op) {
      case "+": return { kind: "Float", value: l + r };
      case "-": return { kind: "Float", value: l - r };
      case "*": return { kind: "Float", value: l * r };
      case "/":
        if (r === 0) throw new Error(`Division by zero at ${formatSpan(span)}`);
        return { kind: "Float", value: l / r };
      case "%":
        if (r === 0) throw new Error(`Modulo by zero at ${formatSpan(span)}`);
        return { kind: "Float", value: l % r };
      case "<": return { kind: "Bool", value: l < r };
      case ">": return { kind: "Bool", value: l > r };
      case "<=": return { kind: "Bool", value: l <= r };
      case ">=": return { kind: "Bool", value: l >= r };
    }
  }

  // String concatenation
  if (left.kind === "String" && right.kind === "String" && op === "++") {
    return { kind: "String", value: left.value + right.value };
  }

  // String ordering (lexicographic)
  if (left.kind === "String" && right.kind === "String") {
    switch (op) {
      case "<": return { kind: "Bool", value: left.value < right.value };
      case ">": return { kind: "Bool", value: left.value > right.value };
      case "<=": return { kind: "Bool", value: left.value <= right.value };
      case ">=": return { kind: "Bool", value: left.value >= right.value };
    }
  }

  throw new Error(`Cannot apply operator ${op} to ${left.kind} and ${right.kind}`);
}

function valueEquals(a: Value, b: Value): boolean {
  // Int and Float compare numerically, so host-injected numbers of either
  // kind compare consistently
  if ((a.kind === "Int" || a.kind === "Float") && (b.kind === "Int" || b.kind === "Float")) {
    return a.value === b.value;
  }
  if (a.kind === "Closure" || a.kind === "BuiltinFn" || b.kind === "Closure" || b.kind === "BuiltinFn") {
    throw new Error("Cannot compare functions for equality");
  }
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "String": return a.value === (b as typeof a).value;
    case "Bool": return a.value === (b as typeof a).value;
    case "Unit": return true;
    case "List":
    case "Tuple": {
      const bs = b as typeof a;
      if (a.elements.length !== bs.elements.length) return false;
      return a.elements.every((el, i) => valueEquals(el, bs.elements[i]));
    }
    case "Record": {
      const bs = b as typeof a;
      if (a.fields.size !== bs.fields.size) return false;
      for (const [k, v] of a.fields) {
        const other = bs.fields.get(k);
        if (other === undefined || !valueEquals(v, other)) return false;
      }
      return true;
    }
    case "Tag": {
      const bs = b as typeof a;
      if (a.tag !== bs.tag || a.args.length !== bs.args.length) return false;
      return a.args.every((arg, i) => valueEquals(arg, bs.args[i]));
    }
  }
  return false;
}

function evalUnaryOp(op: string, operand: Value): Value {
  if (op === "!" && operand.kind === "Bool") {
    return { kind: "Bool", value: !operand.value };
  }
  if (op === "-" && operand.kind === "Int") {
    return { kind: "Int", value: -operand.value };
  }
  if (op === "-" && operand.kind === "Float") {
    return { kind: "Float", value: -operand.value };
  }
  throw new Error(`Cannot apply unary ${op} to ${operand.kind}`);
}
