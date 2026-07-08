import { Expr } from "./ast";

export type Value =
  | { kind: "Int"; value: number }
  | { kind: "Float"; value: number }
  | { kind: "String"; value: string }
  | { kind: "Bool"; value: boolean }
  | { kind: "Unit" }
  | { kind: "List"; elements: Value[] }
  | { kind: "Tuple"; elements: Value[] }
  | { kind: "Record"; fields: Map<string, Value> }
  | { kind: "Tag"; tag: string; args: Value[] }
  | { kind: "Closure"; param: string; body: Expr; env: Map<string, Value> }
  | { kind: "BuiltinFn"; name: string; arity: number; applied: Value[]; fn: (args: Value[]) => Value };

function escapeString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
}

export function prettyPrint(v: Value): string {
  switch (v.kind) {
    case "Int": return String(v.value);
    case "Float": return String(v.value);
    case "String": return `"${escapeString(v.value)}"`;
    case "Bool": return String(v.value);
    case "Unit": return "()";
    case "List": return `[${v.elements.map(prettyPrint).join(", ")}]`;
    case "Tuple": return `(${v.elements.map(prettyPrint).join(", ")})`;
    case "Record": {
      const fields = [...v.fields.entries()]
        .map(([k, val]) => `${k}: ${prettyPrint(val)}`)
        .join(", ");
      return `{ ${fields} }`;
    }
    case "Tag":
      return v.args.length === 0
        ? v.tag
        : `${v.tag}(${v.args.map(prettyPrint).join(", ")})`;
    case "Closure": return "<fn>";
    case "BuiltinFn": return `<builtin:${v.name}>`;
  }
}
