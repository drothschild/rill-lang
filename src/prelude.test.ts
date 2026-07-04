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
});
