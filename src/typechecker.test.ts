import { describe, it, expect, beforeEach } from "vitest";
import { infer, createPreludeTypeEnv, bindType } from "./typechecker";
import { parse } from "./parser";
import { lex } from "./lexer";
import { prettyType, resetTypeVarCounter, Type, T } from "./types";

function typeOf(source: string): string {
  resetTypeVarCounter();
  const type = infer(parse(lex(source)));
  return prettyType(type);
}

describe("Type Inference", () => {
  describe("literals", () => {
    it("infers Int", () => expect(typeOf("42")).toBe("Int"));
    it("infers Float", () => expect(typeOf("3.14")).toBe("Float"));
    it("infers String", () => expect(typeOf('"hello"')).toBe("String"));
    it("infers Bool", () => expect(typeOf("true")).toBe("Bool"));
  });

  describe("arithmetic", () => {
    it("infers Int for addition", () => expect(typeOf("1 + 2")).toBe("Int"));
    it("infers Bool for comparison", () => expect(typeOf("1 < 2")).toBe("Bool"));
    it("infers String for concatenation", () => expect(typeOf('"a" ++ "b"')).toBe("String"));
  });

  describe("let bindings", () => {
    it("infers let binding type", () => {
      expect(typeOf("let x = 5 in x")).toBe("Int");
    });

    it("infers through let binding", () => {
      expect(typeOf("let x = 5 in x + 1")).toBe("Int");
    });
  });

  describe("functions", () => {
    it("infers identity function type", () => {
      expect(typeOf("fn(x) -> x")).toMatch(/-> /);
    });

    it("infers concrete function type", () => {
      expect(typeOf("fn(x) -> x + 1")).toBe("Int -> Int");
    });

    it("infers multi-param function type", () => {
      // Without type classes, + is polymorphic over its operands
      expect(typeOf("fn(a, b) -> a + b")).toMatch(/-> .+ -> /);
    });

    it("infers function application", () => {
      expect(typeOf("let f = fn(x) -> x + 1 in f(5)")).toBe("Int");
    });
  });

  describe("let-polymorphism", () => {
    it("allows polymorphic use of identity", () => {
      expect(typeOf('let id = fn(x) -> x in let a = id(5) in id("hi")')).toBe("String");
    });
  });

  describe("data structures", () => {
    it("infers list type", () => {
      expect(typeOf("[1, 2, 3]")).toBe("List(Int)");
    });

    it("rejects heterogeneous lists", () => {
      expect(() => typeOf('[1, "two"]')).toThrow();
    });

    it("infers tuple type", () => {
      expect(typeOf('(1, "hello")')).toBe("(Int, String)");
    });

    it("infers record type", () => {
      const t = typeOf('{ name: "Alice", age: 30 }');
      expect(t).toContain("name: String");
      expect(t).toContain("age: Int");
    });

    it("infers field access type", () => {
      expect(typeOf('let r = { name: "Alice" } in r.name')).toBe("String");
    });

    it("infers tagged value type", () => {
      expect(typeOf("Ok(42)")).toBe("Result(Int, String)");
    });
  });

  describe("pipes", () => {
    it("infers pipe type", () => {
      expect(typeOf("let f = fn(x) -> x + 1 in 5 |> f")).toBe("Int");
    });

    it("rejects type mismatch in pipe", () => {
      expect(() => typeOf('let f = fn(x) -> x + 1 in "hi" |> f')).toThrow();
    });
  });

  describe("error handling types", () => {
    it("infers ? unwraps Result", () => {
      expect(typeOf("let x = Ok(42) in x?")).toBe("Int");
    });

    it("rejects ? on non-Result", () => {
      expect(() => typeOf("let x = 42 in x?")).toThrow();
    });

    it("infers catch collapses Result", () => {
      expect(typeOf("let x = Ok(42) in x |> catch e -> 0")).toBe("Int");
    });
  });

  describe("pattern matching types", () => {
    it("infers match on booleans", () => {
      expect(typeOf("match true { true -> 1, false -> 0 }")).toBe("Int");
    });

    it("rejects inconsistent branch types", () => {
      expect(() => typeOf('match true { true -> 1, false -> "no" }')).toThrow();
    });

    it("infers match with tag patterns", () => {
      expect(typeOf("match Ok(5) { Ok(n) -> n + 1, Err(e) -> 0 }")).toBe("Int");
    });
  });

  describe("type errors", () => {
    it("rejects Int + String", () => {
      expect(() => typeOf('5 + "hello"')).toThrow();
    });

    it("rejects applying non-function", () => {
      expect(() => typeOf("let x = 5 in x(3)")).toThrow();
    });
  });

  describe("error messages", () => {
    it("includes source location in type error", () => {
      try {
        infer(parse(lex('5 + "hello"')), undefined, '5 + "hello"');
        expect.unreachable();
      } catch (e: any) {
        expect(e.message).toContain("line 1");
        expect(e.message).toContain("Int");
        expect(e.message).toContain("String");
      }
    });

    it("includes helpful message for ? on non-Result", () => {
      try {
        infer(parse(lex("5?")), undefined, "5?");
        expect.unreachable();
      } catch (e: any) {
        expect(e.message).toContain("Result");
      }
    });
  });

  describe("Open field access", () => {
    // Helper to flatten a nested record type by walking the rest chain
    function flattenRecord(t: Type): Map<string, Type> {
      const result = new Map<string, Type>();
      let current: Type | null = t;
      while (current) {
        if (current.kind === "TRecord") {
          for (const [k, v] of current.fields) {
            result.set(k, v);
          }
          current = current.rest;
        } else {
          // Stop at TVar or other types
          break;
        }
      }
      return result;
    }

    it("AC4.1: open record accretes a second field via row tail", () => {
      resetTypeVarCounter();
      const result = infer(parse(lex("fn(r) -> r.a + r.b + 1")));

      // Should infer as fn type
      expect(result.kind).toBe("TFn");

      const param = result.param;
      expect(param.kind).toBe("TRecord");

      // Flatten the record to get all fields including those in rest chain
      const fields = flattenRecord(param);

      // Both a and b should be present and Int
      expect(fields.has("a")).toBe(true);
      expect(fields.has("b")).toBe(true);
      expect(fields.get("a")).toEqual({ kind: "TCon", name: "Int" });
      expect(fields.get("b")).toEqual({ kind: "TCon", name: "Int" });

      // The record should be open (rest chain should exist or be a TVar)
      expect(param.rest).not.toBeNull();

      // Return type should be Int
      expect(result.ret).toEqual({ kind: "TCon", name: "Int" });
    });

    it("AC4.2: polymorphic accessor used at two different shapes", () => {
      resetTypeVarCounter();
      // let get_a = fn(r) -> r.a in get_a({a: 1, b: 2}) + get_a({a: 3, c: "x"})
      const source = 'let get_a = fn(r) -> r.a in get_a({a: 1, b: 2}) + get_a({a: 3, c: "x"})';

      // This should type-check without throwing
      // The polymorphic accessor's row variable instantiates differently per call site
      expect(() => {
        resetTypeVarCounter();
        infer(parse(lex(source)));
      }).not.toThrow();
    });

    it("AC4.3: missing field on closed record throws No field error", () => {
      resetTypeVarCounter();
      // Closed record literal {a: 1} only has field a, accessing b should fail
      expect(() => {
        infer(parse(lex("let x = {a: 1} in x.b")));
      }).toThrow(/No field/);
    });
  });

  describe("Prelude type environment", () => {
    // Custom typeToString that renders TResult(x) as Result(<x>) (single-arg)
    function typeToString(t: Type, varNames: Map<number, string>): string {
      switch (t.kind) {
        case "TCon":
          return t.name;
        case "TVar": {
          const name = varNames.get(t.id);
          if (name) return name;
          // First appearance: assign the next letter
          const nextLetter = String.fromCharCode(97 + varNames.size); // 'a', 'b', etc.
          varNames.set(t.id, nextLetter);
          return nextLetter;
        }
        case "TFn": {
          const paramStr = typeToString(t.param, varNames);
          const retStr = typeToString(t.ret, varNames);
          // Wrap param in parens if it's an arrow type
          const wrappedParam = t.param.kind === "TFn" ? `(${paramStr})` : paramStr;
          return `${wrappedParam} -> ${retStr}`;
        }
        case "TList": {
          const elemStr = typeToString(t.element, varNames);
          return `List(${elemStr})`;
        }
        case "TResult": {
          const okStr = typeToString(t.ok, varNames);
          return `Result(${okStr})`;
        }
        case "TTuple": {
          const elemStrs = t.elements.map(e => typeToString(e, varNames));
          return `(${elemStrs.join(", ")})`;
        }
        case "TRecord":
          return "[Record]"; // Simplified for prelude tests
        case "TTag":
          return `[Tag: ${t.tag}]`; // Simplified for prelude tests
      }
    }

    function schemeToString(scheme: { vars: number[]; type: Type }): string {
      const varNames = new Map<number, string>();
      // Assign letters based on sorted var IDs to ensure consistent naming
      const sortedVars = [...scheme.vars].sort((a, b) => a - b);
      for (let i = 0; i < sortedVars.length; i++) {
        varNames.set(sortedVars[i], String.fromCharCode(97 + i));
      }
      return typeToString(scheme.type, varNames);
    }

    // AC5.1: Canonical schemes render correctly
    it("AC5.1: map renders as (a -> b) -> List(a) -> List(b)", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      const scheme = env.get("map");
      expect(scheme).toBeDefined();
      const rendered = schemeToString(scheme!);
      expect(rendered).toBe("(a -> b) -> List(a) -> List(b)");
    });

    it("AC5.1: filter renders as (a -> Bool) -> List(a) -> List(a)", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      const scheme = env.get("filter");
      expect(scheme).toBeDefined();
      const rendered = schemeToString(scheme!);
      expect(rendered).toBe("(a -> Bool) -> List(a) -> List(a)");
    });

    it("AC5.1: fold renders as b -> (b -> a -> b) -> List(a) -> b", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      const scheme = env.get("fold");
      expect(scheme).toBeDefined();
      const rendered = schemeToString(scheme!);
      expect(rendered).toBe("b -> (b -> a -> b) -> List(a) -> b");
    });

    it("AC5.1: head renders as List(a) -> Result(a)", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      const scheme = env.get("head");
      expect(scheme).toBeDefined();
      const rendered = schemeToString(scheme!);
      expect(rendered).toBe("List(a) -> Result(a)");
    });

    it("AC5.1: tail renders as List(a) -> Result(List(a))", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      const scheme = env.get("tail");
      expect(scheme).toBeDefined();
      const rendered = schemeToString(scheme!);
      expect(rendered).toBe("List(a) -> Result(List(a))");
    });

    // AC5.2: str_len type
    it("AC5.2: str_len exists in prelude type env and has type String -> Int", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      expect(env.has("str_len")).toBe(true);
      const scheme = env.get("str_len");
      expect(scheme).toBeDefined();
      const rendered = schemeToString(scheme!);
      expect(rendered).toBe("String -> Int");
    });

    // AC5.3: length rejects String argument at type level
    it("AC5.3: length typed as List(a) -> Int rejects String argument", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      expect(() => infer(parse(lex('length("hello")')), env)).toThrow(/unify/i);
    });

    it("AC5.3: str_len accepts String argument", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      expect(() => infer(parse(lex('str_len("hello")')), env)).not.toThrow();
    });

    it("AC5.3: length accepts List argument", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      expect(() => infer(parse(lex("length([1, 2, 3])")), env)).not.toThrow();
    });
  });
});

describe("record and tag unification regressions", () => {
  beforeEach(() => resetTypeVarCounter());

  it("typechecks a match whose arms both produce records (boot-gate stack overflow regression)", () => {
    expect(typeOf("match true { true -> {ok: true}, _ -> {ok: false} }")).toBe("{ ok: Bool }");
  });

  it("typechecks a list of record literals", () => {
    expect(typeOf("[{a: 1}, {a: 2}]")).toBe("List({ a: Int })");
  });

  it("typechecks a rule-shaped match over an injected open record signature", () => {
    resetTypeVarCounter();
    let env = createPreludeTypeEnv();
    env = bindType(env, "job", T.record({ current_stage: T.String }, true));
    const src =
      'let r = match job.current_stage { "Rejected" -> {active: false}, _ -> {active: true} } in r';
    const type = infer(parse(lex(src)), env);
    expect(prettyType(type)).toBe("{ active: Bool }");
  });

  it("typechecks the same custom tag across match branches", () => {
    expect(typeOf("match true { true -> Some(1), _ -> Some(2) }")).toBe("Some(Int)");
  });

  it("typechecks identical nullary custom tags across match branches", () => {
    expect(typeOf("match true { true -> None, _ -> None }")).toBe("None");
  });

  it("rejects different custom tags across branches with a message naming both tags", () => {
    expect(() => typeOf("match true { true -> Some(1), _ -> None }")).toThrow(/tag Some.*tag None/);
  });

  it("reports an infinite type instead of overflowing when a variable is unified with a tag wrapping it", () => {
    expect(() => typeOf("fn(x) -> match true { true -> x, _ -> Some(x) }")).toThrow(/infinite type/);
  });
});
