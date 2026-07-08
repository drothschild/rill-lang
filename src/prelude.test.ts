import { describe, it, expect } from "vitest";
import { evaluate } from "./evaluator";
import { parse } from "./parser";
import { lex } from "./lexer";
import { prettyPrint, Value } from "./values";
import { createPrelude } from "./prelude";

function run(source: string): Value {
  return evaluate(parse(lex(source)), createPrelude());
}

function runPrint(source: string): string {
  return prettyPrint(run(source));
}

describe("Prelude", () => {
  describe("map", () => {
    it("maps over a list", () => {
      expect(runPrint("map(fn(x) -> x * 2, [1, 2, 3])")).toBe("[2, 4, 6]");
    });

    it("works with pipes", () => {
      expect(runPrint("[1, 2, 3] |> map(fn(x) -> x * 2)")).toBe("[2, 4, 6]");
    });
  });

  describe("filter", () => {
    it("filters a list", () => {
      expect(runPrint("filter(fn(x) -> x > 2, [1, 2, 3, 4])")).toBe("[3, 4]");
    });

    it("works with pipes", () => {
      expect(runPrint("[1, 2, 3, 4] |> filter(fn(x) -> x > 2)")).toBe("[3, 4]");
    });
  });

  describe("fold", () => {
    it("folds a list", () => {
      expect(runPrint("fold(0, fn(acc, x) -> acc + x, [1, 2, 3])")).toBe("6");
    });

    it("works with pipes", () => {
      expect(runPrint("[1, 2, 3] |> fold(0, fn(acc, x) -> acc + x)")).toBe("6");
    });
  });

  describe("length", () => {
    it("returns list length", () => {
      expect(runPrint("length([1, 2, 3])")).toBe("3");
    });

    it("returns string length", () => {
      expect(runPrint('length("hello")')).toBe("5");
    });
  });

  describe("head and tail", () => {
    it("head returns Ok of first element", () => {
      expect(runPrint("head([1, 2, 3])")).toBe("Ok(1)");
    });

    it("head returns Err on empty list", () => {
      expect(runPrint("head([])")).toBe('Err("empty list")');
    });

    it("tail returns Ok of rest", () => {
      expect(runPrint("tail([1, 2, 3])")).toBe("Ok([2, 3])");
    });

    it("tail returns Err on empty list", () => {
      expect(runPrint("tail([])")).toBe('Err("empty list")');
    });
  });

  describe("to_string", () => {
    it("converts int to string", () => {
      expect(runPrint("to_string(42)")).toBe('"42"');
    });
  });

  describe("str_len", () => {
    it("returns string length", () => {
      expect(runPrint('str_len("hello")')).toBe("5");
    });

    it("returns correct length for empty string", () => {
      expect(runPrint('str_len("")')).toBe("0");
    });
  });

  describe("pipeline composition", () => {
    it("chains filter, map, and fold", () => {
      expect(runPrint(`
        [1, 2, 3, 4, 5]
        |> filter(fn(x) -> x > 2)
        |> map(fn(x) -> x * 10)
        |> fold(0, fn(acc, x) -> acc + x)
      `)).toBe("120");
    });
  });

  describe("count", () => {
    it("counts elements matching the predicate", () => {
      expect(runPrint("count(fn(x) -> x > 2, [1, 2, 3, 4])")).toBe("2");
    });

    it("returns 0 for an empty list", () => {
      expect(runPrint("count(fn(x) -> x > 2, [])")).toBe("0");
    });

    it("works with pipes", () => {
      expect(runPrint("[1, 2, 3, 4] |> count(fn(x) -> x > 2)")).toBe("2");
    });
  });

  describe("contains", () => {
    it("finds an Int in a list", () => {
      expect(runPrint("contains(2, [1, 2, 3])")).toBe("true");
    });

    it("returns false when the item is absent", () => {
      expect(runPrint("contains(5, [1, 2, 3])")).toBe("false");
    });

    it("finds a String in a list", () => {
      expect(runPrint('contains("b", ["a", "b"])')).toBe("true");
    });

    it("returns false on an empty list", () => {
      expect(runPrint("contains(1, [])")).toBe("false");
    });

    it("compares tuples structurally", () => {
      expect(runPrint('contains((1, "a"), [(2, "b"), (1, "a")])')).toBe("true");
    });

    it("works with pipes", () => {
      expect(runPrint('["a", "b"] |> contains("b")')).toBe("true");
    });
  });

  describe("one_of", () => {
    it("takes (value, candidates) and matches contains semantics", () => {
      expect(runPrint('one_of("Offer", ["Interview", "Offer"])')).toBe("true");
    });

    it("returns false when the value is not a candidate", () => {
      expect(runPrint('one_of("Applied", ["Interview", "Offer"])')).toBe("false");
    });
  });

  describe("lookup", () => {
    it("returns Ok of the value for a matching key", () => {
      expect(runPrint('lookup("b", [("a", 1), ("b", 2)])')).toBe("Ok(2)");
    });

    it("returns the first match", () => {
      expect(runPrint('lookup("a", [("a", 1), ("a", 2)])')).toBe("Ok(1)");
    });

    it("returns Err naming the missing String key", () => {
      expect(runPrint('lookup("c", [("a", 1), ("b", 2)])')).toBe('Err("not found: c")');
    });

    it("returns Err naming the missing Int key", () => {
      expect(runPrint('lookup(3, [(1, "x")])')).toBe('Err("not found: 3")');
    });

    it("returns Err on an empty list", () => {
      expect(runPrint('lookup("a", [])')).toBe('Err("not found: a")');
    });
  });

  describe("require", () => {
    it("returns Ok(()) when the condition holds", () => {
      expect(runPrint('require(true, "msg")')).toBe("Ok(())");
    });

    it("returns Err with the message when the condition fails", () => {
      expect(runPrint('require(false, "Company name is required")')).toBe('Err("Company name is required")');
    });

    it("chains with ? for first-error-wins validation", () => {
      expect(runPrint(`
        let a = require(true, "first")? in
        let b = require(false, "second")? in
        let c = require(false, "third")? in
        Ok("valid")
      `)).toBe('Err("second")');
    });

    it("falls through to the success value when every check passes", () => {
      expect(runPrint(`
        let a = require(true, "first")? in
        let b = require(true, "second")? in
        Ok("valid")
      `)).toBe('Ok("valid")');
    });
  });
});
