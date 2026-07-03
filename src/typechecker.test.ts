import { describe, it, expect, beforeEach } from "vitest";
import { infer } from "./typechecker";
import { parse } from "./parser";
import { lex } from "./lexer";
import { prettyType, resetTypeVarCounter, Type } from "./types";

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
});
