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
  });

  describe("functions", () => {
    it("defines and calls a function", () => {
      expect(runPrint("let double = fn(x) -> x * 2 in double(5)")).toBe("10");
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

    it("pipe after catch fallback applies to the pipeline result", () => {
      // The |> g stage runs on the value flowing through catch, not inside the fallback
      expect(runPrint("let g = fn n -> n * 2 in 10 |> catch e -> 1 |> g")).toBe("20");
    });

    it("pipe after catch fallback applies to the fallback value on the error path", () => {
      expect(runPrint('let g = fn n -> n * 2 in Err("bad") |> catch e -> 1 |> g')).toBe("2");
    });
  });

  describe("calls on non-identifier callees", () => {
    it("applies a parenthesized lambda", () => {
      expect(runPrint("(fn x -> x + 1)(5)")).toBe("6");
    });

    it("calls a function stored in a record field", () => {
      expect(runPrint("let r = {f: fn x -> x + 1} in r.f(5)")).toBe("6");
    });

    it("calls the result of a call", () => {
      expect(runPrint("let g = fn(a) -> fn(b) -> a + b in g(1)(2)")).toBe("3");
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

    it("evaluates tagged values", () => {
      expect(runPrint("Ok(42)")).toBe("Ok(42)");
      expect(runPrint("None")).toBe("None");
    });
  });

  describe("if/then/else", () => {
    it("takes the then branch when true", () => {
      expect(runPrint("if true then 1 else 2")).toBe("1");
    });

    it("takes the else branch when false", () => {
      expect(runPrint("if false then 1 else 2")).toBe("2");
    });

    it("evaluates the condition expression", () => {
      expect(runPrint('if 2 > 1 then "yes" else "no"')).toBe('"yes"');
    });

    it("chains else-if", () => {
      expect(runPrint(`
        let x = 5 in
        if x > 10 then "big"
        else if x > 3 then "mid"
        else "small"
      `)).toBe('"mid"');
    });

    it("only evaluates the taken branch", () => {
      // The untaken branch would divide by... nothing observable here;
      // use a match that would fail if evaluated
      expect(runPrint('if true then 1 else match 0 { 1 -> 2 }')).toBe("1");
    });

    it("binds a trailing pipe into the else branch", () => {
      expect(runPrint("let double = fn n -> n * 2 in if false then 1 else 10 |> double")).toBe("20");
    });

    it("does not apply a trailing pipe to the then branch", () => {
      expect(runPrint("let double = fn n -> n * 2 in if true then 1 else 10 |> double")).toBe("1");
    });

    it("pipes the whole if when parenthesized", () => {
      expect(runPrint("let double = fn n -> n * 2 in (if true then 1 else 10) |> double")).toBe("2");
    });

    it("throws when the condition is not a Bool", () => {
      expect(() => run("if 1 then 2 else 3")).toThrow(/If condition must be Bool/);
    });
  });

  describe("structural equality", () => {
    it("compares lists", () => {
      expect(runPrint("[1, 2] == [1, 2]")).toBe("true");
      expect(runPrint("[1, 2] == [1, 3]")).toBe("false");
      expect(runPrint("[1, 2] != [1, 3]")).toBe("true");
      expect(runPrint("[1] == [1, 2]")).toBe("false");
    });

    it("compares tuples", () => {
      expect(runPrint('(1, "a") == (1, "a")')).toBe("true");
      expect(runPrint('(1, "a") == (1, "b")')).toBe("false");
    });

    it("compares records", () => {
      expect(runPrint("{ a: 1, b: 2 } == { a: 1, b: 2 }")).toBe("true");
      expect(runPrint("{ a: 1 } == { a: 2 }")).toBe("false");
    });

    it("compares tags", () => {
      expect(runPrint("Ok(1) == Ok(1)")).toBe("true");
      expect(runPrint('Ok(1) == Err("x")')).toBe("false");
      expect(runPrint("Some(1) != Some(2)")).toBe("true");
      expect(runPrint("None == None")).toBe("true");
    });

    it("compares unit", () => {
      expect(runPrint("() == ()")).toBe("true");
      expect(runPrint("() != ()")).toBe("false");
    });

    it("compares nested structures", () => {
      expect(runPrint("[{ a: Ok(1) }] == [{ a: Ok(1) }]")).toBe("true");
      expect(runPrint("[{ a: Ok(1) }] == [{ a: Ok(2) }]")).toBe("false");
    });

    it("errors when comparing functions", () => {
      expect(() => run("let f = fn(x) -> x in f == f")).toThrow(/compare functions/);
    });
  });

  describe("string ordering", () => {
    it("orders strings lexicographically", () => {
      expect(runPrint('"a" < "b"')).toBe("true");
      expect(runPrint('"b" > "a"')).toBe("true");
      expect(runPrint('"a" <= "a"')).toBe("true");
      expect(runPrint('"b" >= "c"')).toBe("false");
    });
  });

  describe("mixed Int/Float numerics", () => {
    it("compares mixed Int and Float with ==/!=", () => {
      expect(runPrint("1 == 1.0")).toBe("true");
      expect(runPrint("1 != 2.5")).toBe("true");
      expect(runPrint("2.5 == 2")).toBe("false");
    });

    it("supports modulo on Float", () => {
      expect(runPrint("5.5 % 2.5")).toBe("0.5");
    });

    it("supports modulo on mixed Int/Float", () => {
      expect(runPrint("5.5 % 2")).toBe("1.5");
    });
  });

  describe("division by zero", () => {
    it("throws on Int division by zero", () => {
      expect(() => run("1 / 0")).toThrow(/Division by zero/);
    });

    it("throws on Int modulo by zero", () => {
      expect(() => run("5 % 0")).toThrow(/Modulo by zero/);
    });

    it("throws on Float division by zero", () => {
      expect(() => run("1.0 / 0.0")).toThrow(/Division by zero/);
    });

    it("throws on Float modulo by zero", () => {
      expect(() => run("5.5 % 0.0")).toThrow(/Modulo by zero/);
    });

    it("throws on mixed division by zero", () => {
      expect(() => run("1 / 0.0")).toThrow(/Division by zero/);
    });

    it("reports the source position", () => {
      expect(() => run("1 / 0")).toThrow(/line 1/);
    });
  });

  describe("short-circuit logic", () => {
    it("&& does not evaluate the right side when left is false", () => {
      expect(runPrint("false && (1 / 0 == 0)")).toBe("false");
    });

    it("|| does not evaluate the right side when left is true", () => {
      expect(runPrint("true || (1 / 0 == 0)")).toBe("true");
    });

    it("still evaluates the right side when needed", () => {
      expect(runPrint("true && false")).toBe("false");
      expect(runPrint("false || true")).toBe("true");
    });
  });
});
