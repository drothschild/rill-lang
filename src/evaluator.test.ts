import { describe, it, expect } from "vitest";
import { evaluate } from "./evaluator";
import { parse } from "./parser";
import { lex } from "./lexer";
import { prettyPrint, Value } from "./values";

function run(source: string): Value {
  return evaluate(parse(lex(source)));
}

function runPrint(source: string): string {
  return prettyPrint(run(source));
}

describe("Evaluator", () => {
  describe("literals", () => {
    it("evaluates integers", () => expect(runPrint("42")).toBe("42"));
    it("evaluates floats", () => expect(runPrint("3.14")).toBe("3.14"));
    it("evaluates strings", () => expect(runPrint('"hello"')).toBe('"hello"'));
    it("evaluates booleans", () => expect(runPrint("true")).toBe("true"));
  });

  describe("arithmetic", () => {
    it("adds integers", () => expect(runPrint("1 + 2")).toBe("3"));
    it("multiplies", () => expect(runPrint("3 * 4")).toBe("12"));
    it("respects precedence", () => expect(runPrint("2 + 3 * 4")).toBe("14"));
    it("subtracts", () => expect(runPrint("10 - 3")).toBe("7"));
    it("divides", () => expect(runPrint("10 / 3")).toBe("3"));
    it("modulo", () => expect(runPrint("10 % 3")).toBe("1"));
  });

  describe("comparison", () => {
    it("equal", () => expect(runPrint("1 == 1")).toBe("true"));
    it("not equal", () => expect(runPrint("1 != 2")).toBe("true"));
    it("less than", () => expect(runPrint("1 < 2")).toBe("true"));
    it("greater than", () => expect(runPrint("2 > 1")).toBe("true"));
  });

  describe("logical", () => {
    it("and", () => expect(runPrint("true && false")).toBe("false"));
    it("or", () => expect(runPrint("false || true")).toBe("true"));
    it("not", () => expect(runPrint("!true")).toBe("false"));
  });

  describe("strings", () => {
    it("concatenates", () => expect(runPrint('"hello" ++ " world"')).toBe('"hello world"'));
  });

  describe("let bindings", () => {
    it("binds and uses a value", () => {
      expect(runPrint("let x = 5 in x + 1")).toBe("6");
    });

    it("supports nested let bindings", () => {
      expect(runPrint("let x = 5 in let y = 10 in x + y")).toBe("15");
    });

    it("evaluates sequential lets without in", () => {
      expect(runPrint("let x = 5 let y = 10 x + y")).toBe("15");
    });

    it("evaluates a _ let binder, discarding the value", () => {
      expect(runPrint("let _ = 1 2")).toBe("2");
    });
  });

  describe("functions", () => {
    it("defines and calls a function", () => {
      expect(runPrint("let double = fn(x) -> x * 2 in double(5)")).toBe("10");
    });

    it("accepts _ as an ignored parameter", () => {
      expect(runPrint("let f = fn _ -> 7 in f(9)")).toBe("7");
    });

    it("supports closures", () => {
      expect(runPrint("let add = fn(a, b) -> a + b in let add5 = add(5) in add5(3)")).toBe("8");
    });

    it("supports recursion with let rec", () => {
      expect(runPrint(`
        let rec factorial = fn(n) ->
          match n <= 1 { true -> 1, false -> n * factorial(n - 1) }
        in factorial(5)
      `)).toBe("120");
    });
  });

  describe("pipes", () => {
    it("pipes a value into a function", () => {
      expect(runPrint("let double = fn(x) -> x * 2 in 5 |> double")).toBe("10");
    });

    it("chains pipes", () => {
      expect(runPrint(`
        let double = fn(x) -> x * 2
        in let inc = fn(x) -> x + 1
        in 5 |> double |> inc
      `)).toBe("11");
    });
  });

  describe("match", () => {
    it("matches integer literals", () => {
      expect(runPrint("match 1 { 1 -> true, 2 -> false }")).toBe("true");
    });

    it("matches wildcards", () => {
      expect(runPrint("match 99 { 1 -> false, _ -> true }")).toBe("true");
    });

    it("matches and binds identifiers", () => {
      expect(runPrint("match 5 { n -> n + 1 }")).toBe("6");
    });

    it("matches tagged values", () => {
      expect(runPrint("match Ok(42) { Ok(n) -> n, Err(e) -> 0 }")).toBe("42");
    });

    it("matches booleans", () => {
      expect(runPrint("match true { true -> 1, false -> 0 }")).toBe("1");
    });
  });

  describe("error handling", () => {
    it("? unwraps Ok", () => {
      expect(runPrint("let x = Ok(42) in x?")).toBe("42");
    });

    it("? short-circuits on Err", () => {
      const result = run('let x = Err("bad") in x?');
      expect(result).toMatchObject({ kind: "Tag", tag: "Err" });
    });

    it("catch recovers from Err", () => {
      expect(runPrint('let x = Err("bad") in x |> catch e -> 0')).toBe("0");
    });

    it("catch with _ binder recovers from Err", () => {
      expect(runPrint('let x = Err("bad") in x |> catch _ -> 0')).toBe("0");
    });

    it("catch passes through Ok", () => {
      expect(runPrint("let x = Ok(42) in x |> catch e -> 0")).toBe("42");
    });

    it("pipeline with ? and catch", () => {
      expect(runPrint(`
        let parse = fn(s) -> match s {
          "42" -> Ok(42),
          _ -> Err("bad")
        }
        in "42" |> parse? |> fn n -> n * 2 |> catch e -> 0
      `)).toBe("84");
    });

    it("pipeline with ? short-circuiting", () => {
      expect(runPrint(`
        let parse = fn(s) -> match s {
          "42" -> Ok(42),
          _ -> Err("bad")
        }
        in "bad" |> parse? |> fn n -> n * 2 |> catch e -> 0
      `)).toBe("0");
    });
  });

  describe("data structures", () => {
    it("evaluates lists", () => {
      expect(runPrint("[1, 2, 3]")).toBe("[1, 2, 3]");
    });

    it("evaluates tuples", () => {
      expect(runPrint('(1, "hello")')).toBe('(1, "hello")');
    });

    it("evaluates records", () => {
      expect(runPrint('{ name: "Alice", age: 30 }')).toContain("name");
    });

    it("evaluates field access", () => {
      expect(runPrint('let user = { name: "Alice" } in user.name')).toBe('"Alice"');
    });

    it("evaluates punned record fields", () => {
      expect(runPrint("let total = 1 in { total }.total")).toBe("1");
    });

    it("evaluates sequential lets ending in a punned record", () => {
      expect(runPrint(`
        let total = 2
        let responded = 1
        { total, responded }.responded
      `)).toBe("1");
    });

    it("evaluates tagged values", () => {
      expect(runPrint("Ok(42)")).toBe("Ok(42)");
      expect(runPrint("None")).toBe("None");
    });
  });
});
