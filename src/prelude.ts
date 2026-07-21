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

// Deep structural equality over values. Total on all value kinds: numbers
// compare by numeric value (Int 5 == Float 5.0, tolerating host kind drift),
// containers compare recursively, functions compare by reference.
function valueEquals(a: Value, b: Value): boolean {
  if ((a.kind === "Int" || a.kind === "Float") && (b.kind === "Int" || b.kind === "Float")) {
    return a.value === b.value;
  }
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "String": return a.value === (b as { kind: "String"; value: string }).value;
    case "Bool": return a.value === (b as { kind: "Bool"; value: boolean }).value;
    case "Unit": return true;
    case "List":
    case "Tuple": {
      const bElements = (b as { kind: "List" | "Tuple"; elements: Value[] }).elements;
      return a.elements.length === bElements.length
        && a.elements.every((el, i) => valueEquals(el, bElements[i]));
    }
    case "Record": {
      const bFields = (b as { kind: "Record"; fields: Map<string, Value> }).fields;
      if (a.fields.size !== bFields.size) return false;
      for (const [key, val] of a.fields) {
        const bVal = bFields.get(key);
        if (bVal === undefined || !valueEquals(val, bVal)) return false;
      }
      return true;
    }
    case "Tag": {
      const bTag = b as { kind: "Tag"; tag: string; args: Value[] };
      return a.tag === bTag.tag
        && a.args.length === bTag.args.length
        && a.args.every((arg, i) => valueEquals(arg, bTag.args[i]));
    }
    default: // Closure, BuiltinFn: reference identity
      return a === b;
  }
}

// Render a value the way to_string does: primitives bare, everything else pretty-printed.
function displayString(v: Value): string {
  if (v.kind === "Int" || v.kind === "Float" || v.kind === "Bool") return String(v.value);
  if (v.kind === "String") return v.value;
  return prettyPrint(v);
}

function membership(name: string): Value {
  return builtin(name, 2, ([item, list]) => {
    assertList(list);
    return { kind: "Bool", value: list.elements.some((el) => valueEquals(item, el)) };
  });
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

  env.set("count", builtin("count", 2, ([f, list]) => {
    assertList(list);
    let n = 0;
    for (const el of list.elements) {
      const result = applyFn(f, el);
      assertBool(result);
      if (result.value) n += 1;
    }
    return { kind: "Int", value: n };
  }));

  // contains(item, list) and one_of(value, candidates): same function, needle
  // first, haystack last (pipeline-friendly: `list |> contains(x)`).
  env.set("contains", membership("contains"));
  env.set("one_of", membership("one_of"));

  env.set("lookup", builtin("lookup", 2, ([key, list]) => {
    assertList(list);
    for (const el of list.elements) {
      if (el.kind !== "Tuple" || el.elements.length !== 2) {
        throw new Error("lookup expects a List of (key, value) tuples");
      }
      if (valueEquals(key, el.elements[0])) {
        return { kind: "Tag", tag: "Ok", args: [el.elements[1]] };
      }
    }
    return { kind: "Tag", tag: "Err", args: [{ kind: "String", value: `not found: ${displayString(key)}` }] };
  }));

  env.set("require", builtin("require", 2, ([cond, msg]) => {
    assertBool(cond);
    if (msg.kind !== "String") throw new Error("require expects a String message");
    if (cond.value) return { kind: "Tag", tag: "Ok", args: [{ kind: "Unit" }] };
    return { kind: "Tag", tag: "Err", args: [msg] };
  }));

  env.set("at", builtin("at", 2, ([idx, list]) => {
    if (idx.kind !== "Int") throw new Error("at expects an Int index");
    assertList(list);
    const index = idx.value;
    if (index < 0 || index >= list.elements.length) {
      return {
        kind: "Tag",
        tag: "Err",
        args: [{ kind: "String", value: `index ${index} out of bounds (list has ${list.elements.length} elements)` }],
      };
    }
    return { kind: "Tag", tag: "Ok", args: [list.elements[index]] };
  }));

  env.set("with_default", builtin("with_default", 2, ([def, opt]) => {
    if (opt.kind === "Tag") {
      if (opt.tag === "Some" && opt.args.length === 1) {
        return opt.args[0];
      }
      if (opt.tag === "None" && opt.args.length === 0) {
        return def;
      }
    }
    throw new Error("with_default expects an Option");
  }));

  env.set("map_option", builtin("map_option", 2, ([f, opt]) => {
    if (opt.kind === "Tag") {
      if (opt.tag === "Some" && opt.args.length === 1) {
        const result = applyFn(f, opt.args[0]);
        return { kind: "Tag", tag: "Some", args: [result] };
      }
      if (opt.tag === "None" && opt.args.length === 0) {
        return { kind: "Tag", tag: "None", args: [] };
      }
    }
    throw new Error("map_option expects an Option");
  }));

  env.set("append", builtin("append", 2, ([a, b]) => {
    assertList(a);
    assertList(b);
    return { kind: "List", elements: [...a.elements, ...b.elements] };
  }));

  return env;
}
