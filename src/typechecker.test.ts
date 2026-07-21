import { describe, it, expect, beforeEach } from "vitest";
import { infer, createPreludeTypeEnv, bindType } from "./typechecker";
import { parse, parseProgram } from "./parser";
import { lex } from "./lexer";
import { prettyType, resetTypeVarCounter, Type, T } from "./types";
import { buildDeclEnv, createPreludeDeclEnv } from "./decls";

function typeOf(source: string): string {
  resetTypeVarCounter();
  const type = infer(parse(lex(source)));
  return prettyType(type);
}

function typeOfProgram(source: string): string {
  resetTypeVarCounter();
  const program = parseProgram(lex(source));
  const declEnv = buildDeclEnv(program.declarations, createPreludeDeclEnv());
  const type = infer(program.body, undefined, source, declEnv);
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

    it("infers record update type — same as base", () => {
      const t = typeOf('let s = { phase: true, setIndex: 0 } in { s | phase: false }');
      expect(t).toContain("phase: Bool");
      expect(t).toContain("setIndex: Int");
    });

    it("infers record update preserves row polymorphism in helpers", () => {
      const t = typeOf('fn(s) -> { s | n: 0 }');
      // Result should be a function type, and the return type should show an open row (with |)
      expect(t).toMatch(/-> {.*\|/);
    });

    it("rejects record update on closed record with absent field", () => {
      expect(() => typeOf('let s = { a: 1 } in { s | b: 2 }')).toThrow(/field|absent|No field/i);
    });

    it("rejects record update with type mismatch on field", () => {
      expect(() => typeOf('let s = { a: 1 } in { s | a: "x" }')).toThrow();
    });

    it("infers record update with multiple fields", () => {
      const t = typeOf('let s = { a: 1, b: 2 } in { s | a: 10, b: 20 }');
      expect(t).toContain("a: Int");
      expect(t).toContain("b: Int");
    });

    it("infers tagged value type", () => {
      expect(typeOf("Ok(42)")).toBe("Result(Int)");
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

    it("infers match with Bool guard", () => {
      expect(typeOf("match Some(5) { Some(x) if x > 0 -> x, _ -> 0 }")).toBe("Int");
    });

    it("allows guard to use pattern bindings", () => {
      expect(typeOf("match Some(3) { Some(x) if x == 3 -> x * 2, _ -> 0 }")).toBe("Int");
    });

    it("rejects non-Bool guard", () => {
      expect(() => typeOf("match Some(3) { Some(x) if x -> x, _ -> 0 }")).toThrow(/Bool/);
    });
  });

  describe("if/then/else types", () => {
    it("infers the branch type", () => {
      expect(typeOf("if true then 1 else 2")).toBe("Int");
    });

    it("infers String branches", () => {
      expect(typeOf('if true then "a" else "b"')).toBe("String");
    });

    it("infers a function over if", () => {
      expect(typeOf("fn x -> if x then 1 else 2")).toBe("Bool -> Int");
    });

    it("rejects a non-Bool condition", () => {
      expect(() => typeOf("if 1 then 2 else 3")).toThrow(/unify/i);
    });

    it("rejects branches that do not unify", () => {
      expect(() => typeOf('if true then 1 else "x"')).toThrow(/unify/i);
    });

    it("infers chained else-if", () => {
      expect(typeOf('if true then "a" else if false then "b" else "c"')).toBe("String");
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
        case "TTuple": {
          const elemStrs = t.elements.map(e => typeToString(e, varNames));
          return `(${elemStrs.join(", ")})`;
        }
        case "TRecord":
          return "[Record]"; // Simplified for prelude tests
        case "TUnion": {
          if (t.args.length === 0) {
            return t.name;
          }
          const argStrs = t.args.map(a => typeToString(a, varNames));
          return `${t.name}(${argStrs.join(", ")})`;
        }
        case "TParam":
          return t.name;
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

  describe("rules prelude builtins", () => {
    function typeWithPrelude(source: string): string {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      return prettyType(infer(parse(lex(source)), env));
    }

    it("count infers Int for a predicate over a list", () => {
      expect(typeWithPrelude("count(fn(x) -> x > 2, [1, 2, 3])")).toBe("Int");
    });

    it("count rejects a non-Bool predicate", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      expect(() => infer(parse(lex("count(fn(x) -> x + 1, [1, 2])")), env)).toThrow(/unify/i);
    });

    it("count works piped", () => {
      expect(typeWithPrelude("[1, 2, 3] |> count(fn(x) -> x > 2)")).toBe("Int");
    });

    it("contains infers Bool", () => {
      expect(typeWithPrelude("contains(2, [1, 2, 3])")).toBe("Bool");
    });

    it("contains rejects an item type mismatching the list element type", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      expect(() => infer(parse(lex('contains("a", [1, 2])')), env)).toThrow(/unify/i);
    });

    it("one_of infers Bool for (value, candidates)", () => {
      expect(typeWithPrelude('one_of("Offer", ["Interview", "Offer"])')).toBe("Bool");
    });

    it("lookup infers Result of the tuple value type", () => {
      expect(typeWithPrelude('lookup("a", [("a", 1), ("b", 2)])')).toBe("Result(Int)");
    });

    it("lookup rejects a key type mismatching the tuple key type", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      expect(() => infer(parse(lex('lookup(1, [("a", 1)])')), env)).toThrow(/unify/i);
    });

    it("require infers Result(Unit)", () => {
      expect(typeWithPrelude('require(true, "msg")')).toBe("Result(Unit)");
    });

    it("require rejects a non-String message", () => {
      resetTypeVarCounter();
      const env = createPreludeTypeEnv();
      expect(() => infer(parse(lex("require(true, 42)")), env)).toThrow(/unify/i);
    });

    it("?-chained require validation typechecks", () => {
      expect(typeWithPrelude(`
        let a = require(str_len("x") > 0, "Company name is required")? in
        let b = require(true, "Role is required")? in
        Ok("valid")
      `)).toBe("Result(String)");
    });
  });
  describe("operator operand constraints", () => {
    describe("arithmetic requires numeric operands", () => {
      it("rejects String +", () => {
        expect(() => typeOf('"a" + "b"')).toThrow();
      });

      it("rejects Bool *", () => {
        expect(() => typeOf("true * false")).toThrow();
      });

      it("accepts Float arithmetic", () => {
        expect(typeOf("1.5 + 2.5")).toBe("Float");
        expect(typeOf("5.5 % 2.5")).toBe("Float");
      });

      it("accepts Int arithmetic", () => {
        expect(typeOf("10 % 3")).toBe("Int");
      });

      it("still rejects mixed Int/Float arithmetic", () => {
        expect(() => typeOf("1 + 2.5")).toThrow();
      });

      it("defaults polymorphic arithmetic operands to Int", () => {
        expect(typeOf("fn(a, b) -> a + b")).toBe("Int -> Int -> Int");
      });
    });

    describe("ordering requires Int, Float, or String", () => {
      it("rejects Bool <", () => {
        expect(() => typeOf("true < false")).toThrow();
      });

      it("rejects List <", () => {
        expect(() => typeOf("[1] < [2]")).toThrow();
      });

      it("accepts String ordering", () => {
        expect(typeOf('"a" < "b"')).toBe("Bool");
      });

      it("accepts mixed Int/Float ordering", () => {
        expect(typeOf("1 < 2.5")).toBe("Bool");
      });
    });

    describe("equality accepts any non-function type", () => {
      it("accepts Unit equality", () => {
        expect(typeOf("() == ()")).toBe("Bool");
      });

      it("accepts List equality", () => {
        expect(typeOf("[1, 2] == [1, 2]")).toBe("Bool");
      });

      it("accepts Result equality", () => {
        expect(typeOf("Ok(1) == Ok(1)")).toBe("Bool");
      });

      it("accepts mixed Int/Float equality", () => {
        expect(typeOf("1 == 2.5")).toBe("Bool");
      });

      it("rejects function equality", () => {
        expect(() => typeOf("let f = fn(x) -> x + 1 in f == f")).toThrow(/function/);
      });
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
    expect(typeOf("match true { true -> Some(1), _ -> Some(2) }")).toBe("Option(Int)");
  });

  it("typechecks identical nullary custom tags across match branches", () => {
    expect(typeOf("match true { true -> None, _ -> None }")).toBe("Option(d)");
  });

  it("matches constructors from same declared union across branches", () => {
    const source = `type Choice = Yes(Int) | No
      match true { true -> Yes(1), _ -> No }`;
    expect(typeOfProgram(source)).toBe("Choice");
  });

  it("reports an infinite type instead of overflowing when a variable is unified with a tag wrapping it", () => {
    expect(() => typeOf("fn(x) -> match true { true -> x, _ -> Some(x) }")).toThrow(/infinite type/);
  });
});

describe("Task 8: Constructor inference for declared unions", () => {
  beforeEach(() => resetTypeVarCounter());

  it("infers Shape constructor with payload", () => {
    const source = `type Shape = Circle(Float) | Square(Float)
      Circle(2.0)`;
    expect(typeOfProgram(source)).toBe("Shape");
  });

  it("rejects constructor with wrong payload type", () => {
    const source = `type Shape = Circle(Float) | Square(Float)
      Circle(2)`;
    expect(() => typeOfProgram(source)).toThrow();
  });

  it("rejects constructor with wrong arity", () => {
    const source = `type Shape = Circle(Float)
      Circle()`;
    expect(() => typeOfProgram(source)).toThrow(/expects 1 arguments, got 0/);
  });

  it("rejects unknown constructor with did-you-mean", () => {
    const source = `type Circle = Circle(Float)
      Circl(2.0)`;
    try {
      typeOfProgram(source);
      expect.unreachable();
    } catch (e: any) {
      expect(e.message).toContain("Unknown constructor");
      expect(e.message).toContain("Circl");
    }
  });

  it("Ok(1) infers Result(Int) from prelude", () => {
    expect(typeOf("Ok(1)")).toBe("Result(Int)");
  });

  it("Err('x') unifies with Ok(1)", () => {
    expect(typeOf('match Ok(1) { Ok(x) -> x, Err(e) -> 0 }')).toBe("Int");
  });

  it("Some(1.0) infers Option(Float) from prelude", () => {
    expect(typeOf("Some(1.0)")).toBe("Option(Float)");
  });

  it("None unifies with Some(1.0)", () => {
    expect(typeOf("match Some(1) { Some(x) -> x, None -> 0 }")).toBe("Int");
  });
});

describe("Task 9: Match-subject unification for TagPat", () => {
  beforeEach(() => resetTypeVarCounter());

  it("matches declared union with Some/None patterns", () => {
    const source = `type Choice(a) = Yes(a) | No
      match Yes(5) { Yes(x) -> x, No -> 0 }`;
    expect(typeOfProgram(source)).toBe("Int");
  });

  it("binds payload variable with instantiated type in match arm", () => {
    const source = `type Event = LogSet({ reps: Int })
      match LogSet({reps: 5}) { LogSet(p) -> p.reps, _ -> 0 }`;
    expect(typeOfProgram(source)).toBe("Int");
  });

  it("rejects constructor not in subject union type", () => {
    const source = `type Shape = Circle(Float)
      match Circle(1.0) { Square(x) -> x, _ -> 0.0 }`;
    expect(() => typeOfProgram(source)).toThrow();
  });

  it("rejects known constructor from different union in pattern (cross-union mismatch)", () => {
    const source = `type Shape = Circle(Float)
      type Color = Red | Blue
      match Circle(1.0) { Red -> 0.0, _ -> 1.0 }`;
    expect(() => typeOfProgram(source)).toThrow();
  });

  it("rejects unknown constructor in pattern with did-you-mean", () => {
    const source = `type Shape = Circle(Float)
      match Circle(1.0) { Circl(x) -> x, _ -> 0.0 }`;
    expect(() => typeOfProgram(source)).toThrow(/Unknown constructor/);
  });

  it("prelude Option patterns work in match", () => {
    const source = `match Some(1.0) { Some(v) -> v, None -> 0.0 }`;
    expect(typeOf(source)).toBe("Float");
  });
});

describe("Task 10: Try, Catch, Pipe forms with declared Result", () => {
  beforeEach(() => resetTypeVarCounter());

  it("? unwraps Result declared from prelude", () => {
    expect(typeOf("Ok(5)?")).toBe("Int");
  });

  it("? in nested context", () => {
    expect(typeOf("let x = Ok(1)? in x + 1")).toBe("Int");
  });

  it("catch binds error as String", () => {
    // Verify that error is bound as String type
    resetTypeVarCounter();
    let env = createPreludeTypeEnv();
    const src = 'Ok(5) |> catch e -> str_len(e)';
    const type = infer(parse(lex(src)), env);
    expect(prettyType(type)).toBe("Int");
  });

  it("pipe with try operator", () => {
    expect(typeOf("Ok(5) |> fn(x) -> x? + 1")).toBe("Int");
  });

  it("? rejects Option type", () => {
    expect(() => typeOf("Some(5)?")).toThrow(/Result/);
  });
});

describe("Task 4: Coverage checker for union subjects", () => {
  beforeEach(() => resetTypeVarCounter());

  it("rejects match missing a union constructor", () => {
    const source = `type Event = StartSession({ nowMs: Int }) | PauseSession | RestElapsed({ nowMs: Int })
      match StartSession({ nowMs: 1 }) { StartSession(p) -> p.nowMs }`;
    let error: Error | undefined;
    try {
      typeOfProgram(source);
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/missing/i);
    expect(error!.message).toMatch(/PauseSession/);
    expect(error!.message).toMatch(/RestElapsed\(_\)/);
    expect(error!.message).toMatch(/line/i);
  });

  it("match with all constructors checks ok", () => {
    const source = `type Event = StartSession({ nowMs: Int }) | PauseSession | RestElapsed({ nowMs: Int })
      match StartSession({ nowMs: 1 }) {
        StartSession(p) -> p.nowMs,
        PauseSession -> 0,
        RestElapsed(p) -> p.nowMs
      }`;
    expect(typeOfProgram(source)).toBe("Int");
  });

  it("unguarded wildcard arm makes match exhaustive", () => {
    const source = `type Event = StartSession({ nowMs: Int }) | PauseSession | RestElapsed({ nowMs: Int })
      match StartSession({ nowMs: 1 }) {
        StartSession(p) -> p.nowMs,
        _ -> 0
      }`;
    expect(typeOfProgram(source)).toBe("Int");
  });

  it("unguarded ident arm makes match exhaustive", () => {
    const source = `type Event = StartSession({ nowMs: Int })
      match StartSession({ nowMs: 1 }) {
        StartSession(p) -> p.nowMs,
        e -> 0
      }`;
    expect(typeOfProgram(source)).toBe("Int");
  });

  it("guarded arms do not count toward coverage", () => {
    const source = `type Event = StartSession | PauseSession | RestElapsed
      match StartSession {
        StartSession if false -> 1,
        PauseSession -> 2,
        RestElapsed -> 3
      }`;
    let error: Error | undefined;
    try {
      typeOfProgram(source);
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/missing/i);
    expect(error!.message).toMatch(/StartSession/);
  });

  it("Option(Int) missing None fails exhaustiveness", () => {
    const source = `match Some(1) { Some(x) -> x }`;
    let error: Error | undefined;
    try {
      typeOf(source);
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/missing/i);
    expect(error!.message).toMatch(/None/);
  });

  it("conservative rule: refutable single pattern does not cover", () => {
    const source = `type Msg = Code(Int)
      match Code(1) {
        Code(1) -> "one"
      }`;
    let error: Error | undefined;
    try {
      typeOfProgram(source);
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/missing/i);
    expect(error!.message).toMatch(/Code\(_\)/);
  });

  it("conservative nested-refutable rule: joint coverage fails", () => {
    const source = `type Wrap = W(Option(Int))
      match W(Some(1)) {
        W(Some(x)) -> x,
        W(None) -> 0
      }`;
    let error: Error | undefined;
    try {
      typeOfProgram(source);
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/missing/i);
    expect(error!.message).toMatch(/W\(_\)/);
  });

  it("conservative rule: unguarded irrefutable payload covers", () => {
    const source = `type Wrap = W(Option(Int))
      match W(Some(1)) {
        W(o) -> match o { Some(x) -> x, None -> 0 },
        _ -> 0
      }`;
    expect(typeOfProgram(source)).toBe("Int");
  });
});

describe("Task 5: Coverage for Bool and non-union subjects", () => {
  beforeEach(() => resetTypeVarCounter());

  it("Bool with true and false is exhaustive", () => {
    const source = `match true { true -> 1, false -> 2 }`;
    expect(typeOf(source)).toBe("Int");
  });

  it("Bool missing false is inexhaustive", () => {
    const source = `match true { true -> 1 }`;
    expect(() => typeOf(source)).toThrow(/Missing patterns:\n\s*- false/);
  });

  it("Int literals require catch-all", () => {
    const source = `match 1 { 1 -> "one", 2 -> "two" }`;
    expect(() => typeOf(source)).toThrow();
  });

  it("Int with wildcard is exhaustive", () => {
    const source = `match 1 { 1 -> "one", 2 -> "two", _ -> "other" }`;
    expect(typeOf(source)).toBe("String");
  });

  it("String requires catch-all", () => {
    const source = `match "hello" { "hello" -> 1, "world" -> 2 }`;
    expect(() => typeOf(source)).toThrow();
  });

  it("unresolved type variable requires catch-all", () => {
    const source = `fn(x) -> match x { 1 -> true }`;
    expect(() => typeOf(source)).toThrow();
  });

  it("unresolved type variable with wildcard is ok", () => {
    const source = `fn(x) -> match x { 1 -> true, _ -> false }`;
    expect(typeOf(source)).toMatch(/-> /);
  });
});

describe("Task 6: AC1.6 wrong-arm payload access + load-gate exhaustiveness tests", () => {
  beforeEach(() => resetTypeVarCounter());

  it("payload access from wrong constructor arm is caught", () => {
    const source = `type Event = LogSet({ reps: Int }) | PauseSession
      match LogSet({ reps: 5 }) {
        LogSet(p) -> p.reps,
        PauseSession -> p.reps
      }`;
    expect(() => typeOfProgram(source)).toThrow();
  });

  it("correct pattern binding allows payload access", () => {
    const source = `type Event = LogSet({ reps: Int }) | PauseSession
      match LogSet({ reps: 5 }) {
        LogSet(p) -> p.reps,
        PauseSession -> 0
      }`;
    expect(typeOfProgram(source)).toBe("Int");
  });

  it("payload-less constructor cannot be given a sub-pattern", () => {
    const source = `type Event = LogSet({ reps: Int }) | PauseSession
      match PauseSession {
        PauseSession(p) -> p,
        _ -> 0
      }`;
    expect(() => typeOfProgram(source)).toThrow();
  });
});
