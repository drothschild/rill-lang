import { Value, prettyPrint } from "./values";
import { applyFn } from "./evaluator";

function builtin(name: string, arity: number, fn: (args: Value[]) => Value): Value {
  return { kind: "BuiltinFn", name, arity, applied: [], fn };
}

function assertList(v: Value): asserts v is { kind: "List"; elements: Value[] } {
  if (v.kind !== "List") throw new Error(`Expected List, got ${v.kind}`);
}

function assertBool(v: Value): asserts v is { kind: "Bool"; value: boolean } {
  if (v.kind !== "Bool") throw new Error(`Expected Bool, got ${v.kind}`);
}

export function createPrelude(): Map<string, Value> {
  const env = new Map<string, Value>();

  env.set("map", builtin("map", 2, ([f, list]) => {
    assertList(list);
    return { kind: "List", elements: list.elements.map((el) => applyFn(f, el)) };
  }));

  env.set("filter", builtin("filter", 2, ([f, list]) => {
    assertList(list);
    return {
      kind: "List",
      elements: list.elements.filter((el) => {
        const result = applyFn(f, el);
        assertBool(result);
        return result.value;
      }),
    };
  }));

  env.set("fold", builtin("fold", 3, ([init, f, list]) => {
    assertList(list);
    return list.elements.reduce((acc, el) => applyFn(applyFn(f, acc), el), init);
  }));

  env.set("length", builtin("length", 1, ([v]) => {
    if (v.kind === "List") return { kind: "Int", value: v.elements.length };
    if (v.kind === "String") return { kind: "Int", value: v.value.length };
    throw new Error("length expects List or String");
  }));

  env.set("str_len", builtin("str_len", 1, ([s]) => {
    if (s.kind !== "String") throw new Error("str_len expects String");
    return { kind: "Int", value: s.value.length };
  }));

  env.set("head", builtin("head", 1, ([list]) => {
    assertList(list);
    if (list.elements.length === 0) return { kind: "Tag", tag: "Err", args: [{ kind: "String", value: "empty list" }] };
    return { kind: "Tag", tag: "Ok", args: [list.elements[0]] };
  }));

  env.set("tail", builtin("tail", 1, ([list]) => {
    assertList(list);
    if (list.elements.length === 0) return { kind: "Tag", tag: "Err", args: [{ kind: "String", value: "empty list" }] };
    return { kind: "Tag", tag: "Ok", args: [{ kind: "List", elements: list.elements.slice(1) }] };
  }));

  env.set("to_string", builtin("to_string", 1, ([v]) => {
    if (v.kind === "Int") return { kind: "String", value: String(v.value) };
    if (v.kind === "Float") return { kind: "String", value: String(v.value) };
    if (v.kind === "Bool") return { kind: "String", value: String(v.value) };
    if (v.kind === "String") return v;
    return { kind: "String", value: prettyPrint(v) };
  }));

  env.set("print", builtin("print", 1, ([v]) => {
    if (v.kind === "String") console.log(v.value);
    else console.log(prettyPrint(v));
    return { kind: "Unit" };
  }));

  env.set("concat", builtin("concat", 2, ([a, b]) => {
    if (a.kind !== "String") throw new Error("concat expects String");
    if (b.kind !== "String") throw new Error("concat expects String");
    return { kind: "String", value: a.value + b.value };
  }));

  env.set("each", builtin("each", 2, ([f, list]) => {
    assertList(list);
    list.elements.forEach((el) => applyFn(f, el));
    return { kind: "Unit" };
  }));

  return env;
}
