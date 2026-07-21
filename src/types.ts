export type Type =
  | { kind: "TCon"; name: string }
  | { kind: "TVar"; id: number }
  | { kind: "TFn"; param: Type; ret: Type }
  | { kind: "TList"; element: Type }
  | { kind: "TTuple"; elements: Type[] }
  | { kind: "TRecord"; fields: Map<string, Type>; rest: Type | null }
  | { kind: "TUnion"; name: string; args: Type[] }
  | { kind: "TParam"; name: string };

let _nextId = 0;
export function freshTypeVar(): Type {
  return { kind: "TVar", id: _nextId++ };
}

export function resetTypeVarCounter(): void {
  _nextId = 0;
}

export function prettyType(t: Type): string {
  switch (t.kind) {
    case "TCon": return t.name;
    case "TVar": return String.fromCharCode(97 + (t.id % 26));
    case "TFn": {
      const param = t.param.kind === "TFn" ? `(${prettyType(t.param)})` : prettyType(t.param);
      return `${param} -> ${prettyType(t.ret)}`;
    }
    case "TList": return `List(${prettyType(t.element)})`;
    case "TTuple": return `(${t.elements.map(prettyType).join(", ")})`;
    case "TRecord": {
      const fields = [...t.fields.entries()].map(([k, v]) => `${k}: ${prettyType(v)}`).join(", ");
      return t.rest ? `{ ${fields} | ${prettyType(t.rest)} }` : `{ ${fields} }`;
    }
    case "TUnion": return t.args.length === 0 ? t.name : `${t.name}(${t.args.map(prettyType).join(", ")})`;
    case "TParam": return t.name;
  }
}

// Public, consumer-facing type constructors. The ONLY sanctioned way for embedders
// to name Rill types when declaring rule input signatures.
export const T = {
  String: { kind: "TCon", name: "String" } as Type,
  Int: { kind: "TCon", name: "Int" } as Type,
  Bool: { kind: "TCon", name: "Bool" } as Type,
  Unit: { kind: "TCon", name: "Unit" } as Type,
  list(element: Type): Type {
    return { kind: "TList", element };
  },
  record(fields: Record<string, Type>, open = false): Type {
    return {
      kind: "TRecord",
      fields: new Map(Object.entries(fields)),
      rest: open ? freshTypeVar() : null,
    };
  },
  union(name: string, args: Type[] = []): Type {
    return { kind: "TUnion", name, args };
  },
};
