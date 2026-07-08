import { describe, it, expect } from "vitest";
import { parse } from "./parser";
import { lex } from "./lexer";
import { prettyPrint } from "./values";

function parseExpr(source: string) {
  return parse(lex(source));
}

describe("Parser", () => {
  describe("literals", () => {
    it("parses integers", () => {
      const ast = parseExpr("42");
      expect(ast).toMatchObject({ kind: "IntLit", value: 42 });
    });

    it("parses floats", () => {
      const ast = parseExpr("3.14");
      expect(ast).toMatchObject({ kind: "FloatLit", value: 3.14 });
    });

    it("parses strings", () => {
      const ast = parseExpr('"hello"');
      expect(ast).toMatchObject({ kind: "StringLit", value: "hello" });
    });

    it("round-trips escaped strings through prettyPrint", () => {
      const source = '"he said \\"hi\\"\\n\\tdone\\\\"';
      const ast = parseExpr(source) as any;
      expect(ast).toMatchObject({ kind: "StringLit", value: 'he said "hi"\n\tdone\\' });
      const printed = prettyPrint({ kind: "String", value: ast.value });
      expect(printed).toBe(source);
      expect(parseExpr(printed)).toMatchObject({ kind: "StringLit", value: ast.value });
    });

    it("parses booleans", () => {
      expect(parseExpr("true")).toMatchObject({ kind: "BoolLit", value: true });
      expect(parseExpr("false")).toMatchObject({ kind: "BoolLit", value: false });
    });

    it("parses identifiers", () => {
      const ast = parseExpr("foo");
      expect(ast).toMatchObject({ kind: "Ident", name: "foo" });
    });
  });

  describe("operators", () => {
    it("parses arithmetic", () => {
      const ast = parseExpr("1 + 2");
      expect(ast).toMatchObject({
        kind: "BinOp", op: "+",
        left: { kind: "IntLit", value: 1 },
        right: { kind: "IntLit", value: 2 },
      });
    });

    it("respects precedence: * binds tighter than +", () => {
      const ast = parseExpr("1 + 2 * 3");
      expect(ast).toMatchObject({
        kind: "BinOp", op: "+",
        left: { kind: "IntLit", value: 1 },
        right: { kind: "BinOp", op: "*", left: { value: 2 }, right: { value: 3 } },
      });
    });

    it("parses comparison operators", () => {
      const ast = parseExpr("a == b");
      expect(ast).toMatchObject({ kind: "BinOp", op: "==" });
    });

    it("parses logical operators", () => {
      const ast = parseExpr("a && b || c");
      expect(ast).toMatchObject({
        kind: "BinOp", op: "||",
        left: { kind: "BinOp", op: "&&" },
        right: { kind: "Ident", name: "c" },
      });
    });

    it("parses string concatenation", () => {
      const ast = parseExpr('"a" ++ "b"');
      expect(ast).toMatchObject({ kind: "BinOp", op: "++" });
    });

    it("parses unary negation", () => {
      const ast = parseExpr("!true");
      expect(ast).toMatchObject({ kind: "UnaryOp", op: "!", expr: { kind: "BoolLit", value: true } });
    });

    it("parses unary minus", () => {
      const ast = parseExpr("-5");
      expect(ast).toMatchObject({ kind: "UnaryOp", op: "-", expr: { kind: "IntLit", value: 5 } });
    });

    it("parses parenthesized expressions", () => {
      const ast = parseExpr("(1 + 2) * 3");
      expect(ast).toMatchObject({
        kind: "BinOp", op: "*",
        left: { kind: "BinOp", op: "+" },
        right: { kind: "IntLit", value: 3 },
      });
    });
  });

  describe("let bindings", () => {
    it("parses let binding", () => {
      const ast = parseExpr("let x = 5 in x + 1");
      expect(ast).toMatchObject({
        kind: "Let", name: "x", rec: false,
        value: { kind: "IntLit", value: 5 },
        body: { kind: "BinOp", op: "+" },
      });
    });

    it("parses let rec", () => {
      const ast = parseExpr("let rec f = fn(n) -> n in f(5)");
      expect(ast).toMatchObject({ kind: "Let", name: "f", rec: true });
    });

    it("parses let without in, body following directly", () => {
      const ast = parseExpr("let x = 5 x + 1");
      expect(ast).toMatchObject({
        kind: "Let", name: "x", rec: false,
        value: { kind: "IntLit", value: 5 },
        body: { kind: "BinOp", op: "+" },
      });
    });

    it("parses sequential lets without in as nested Lets", () => {
      const ast = parseExpr(`
        let x = 5
        let y = 10
        x + y
      `);
      expect(ast).toMatchObject({
        kind: "Let", name: "x",
        value: { kind: "IntLit", value: 5 },
        body: {
          kind: "Let", name: "y",
          value: { kind: "IntLit", value: 10 },
          body: { kind: "BinOp", op: "+" },
        },
      });
    });

    it("parses _ as a let binder", () => {
      const ast = parseExpr("let _ = 5 10");
      expect(ast).toMatchObject({
        kind: "Let", name: "_",
        value: { kind: "IntLit", value: 5 },
        body: { kind: "IntLit", value: 10 },
      });
    });
  });

  describe("functions", () => {
    it("parses single-param function", () => {
      const ast = parseExpr("fn(x) -> x + 1");
      expect(ast).toMatchObject({
        kind: "Fn", param: "x",
        body: { kind: "BinOp", op: "+" },
      });
    });

    it("parses multi-param function as curried", () => {
      // fn(a, b) -> a + b  desugars to  fn(a) -> fn(b) -> a + b
      const ast = parseExpr("fn(a, b) -> a + b");
      expect(ast).toMatchObject({
        kind: "Fn", param: "a",
        body: { kind: "Fn", param: "b", body: { kind: "BinOp", op: "+" } },
      });
    });

    it("parses function calls", () => {
      const ast = parseExpr("f(5)");
      expect(ast).toMatchObject({
        kind: "Call",
        fn: { kind: "Ident", name: "f" },
        arg: { kind: "IntLit", value: 5 },
      });
    });

    it("accepts _ as a parameter", () => {
      const ast = parseExpr("fn(_) -> 1");
      expect(ast).toMatchObject({ kind: "Fn", param: "_", body: { kind: "IntLit", value: 1 } });
    });

    it("accepts _ as a shorthand parameter", () => {
      const ast = parseExpr("fn _ -> 1");
      expect(ast).toMatchObject({ kind: "Fn", param: "_" });
    });

    it("parses multi-arg calls as curried application", () => {
      // f(a, b) desugars to f(a)(b)
      const ast = parseExpr("f(1, 2)");
      expect(ast).toMatchObject({
        kind: "Call",
        fn: { kind: "Call", fn: { kind: "Ident", name: "f" }, arg: { kind: "IntLit", value: 1 } },
        arg: { kind: "IntLit", value: 2 },
      });
    });

    it("parses a call on a parenthesized lambda", () => {
      const ast = parseExpr("(fn x -> x + 1)(5)");
      expect(ast).toMatchObject({
        kind: "Call",
        fn: { kind: "Fn", param: "x" },
        arg: { kind: "IntLit", value: 5 },
      });
    });

    it("parses a call on a field access", () => {
      const ast = parseExpr("r.f(5)");
      expect(ast).toMatchObject({
        kind: "Call",
        fn: { kind: "FieldAccess", expr: { kind: "Ident", name: "r" }, field: "f" },
        arg: { kind: "IntLit", value: 5 },
      });
    });

    it("parses chained calls on a call result", () => {
      const ast = parseExpr("g(1)(2)");
      expect(ast).toMatchObject({
        kind: "Call",
        fn: { kind: "Call", fn: { kind: "Ident", name: "g" }, arg: { kind: "IntLit", value: 1 } },
        arg: { kind: "IntLit", value: 2 },
      });
    });
  });

  describe("pipes", () => {
    it("parses pipe operator", () => {
      const ast = parseExpr("5 |> double");
      expect(ast).toMatchObject({
        kind: "Pipe",
        left: { kind: "IntLit", value: 5 },
        right: { kind: "Ident", name: "double" },
      });
    });

    it("chains pipes left-to-right", () => {
      const ast = parseExpr("5 |> double |> print");
      expect(ast).toMatchObject({
        kind: "Pipe",
        left: { kind: "Pipe", left: { value: 5 }, right: { name: "double" } },
        right: { kind: "Ident", name: "print" },
      });
    });

    it("parses pipe into partial application", () => {
      const ast = parseExpr('[1, 2] |> map(fn(x) -> x * 2)');
      expect(ast).toMatchObject({
        kind: "Pipe",
        left: { kind: "List" },
        right: { kind: "Call" },
      });
    });
  });

  describe("try operator (?)", () => {
    it("parses ? as postfix", () => {
      const ast = parseExpr("parse_int(x)?");
      expect(ast).toMatchObject({
        kind: "Try",
        expr: { kind: "Call" },
      });
    });

    it("parses ? in pipeline", () => {
      const ast = parseExpr("x |> parse?");
      expect(ast).toMatchObject({
        kind: "Pipe",
        right: { kind: "Try", expr: { kind: "Ident", name: "parse" } },
      });
    });
  });

  describe("catch", () => {
    it("parses catch expression", () => {
      const ast = parseExpr("x |> parse? |> catch e -> 0");
      expect(ast).toMatchObject({
        kind: "Pipe",
        left: { kind: "Pipe" },
        right: { kind: "Catch", errorName: "e", fallback: { kind: "IntLit", value: 0 } },
      });
    });

    it("accepts _ as the error binder", () => {
      const ast = parseExpr("x |> catch _ -> 0");
      expect(ast).toMatchObject({
        kind: "Pipe",
        right: { kind: "Catch", errorName: "_", fallback: { kind: "IntLit", value: 0 } },
      });
    });
    it("keeps a pipe after the catch fallback as a pipeline stage", () => {
      // x |> catch e -> d |> g  means  (x |> catch e -> d) |> g
      const ast = parseExpr("x |> catch e -> d |> g");
      expect(ast).toMatchObject({
        kind: "Pipe",
        left: {
          kind: "Pipe",
          left: { kind: "Ident", name: "x" },
          right: { kind: "Catch", errorName: "e", fallback: { kind: "Ident", name: "d" } },
        },
        right: { kind: "Ident", name: "g" },
      });
    });

    it("rejects a standalone catch expression", () => {
      expect(() => parseExpr("catch e -> 42")).toThrow(/catch must follow a pipeline \|>/);
    });

    it("rejects catch outside pipe position inside a let", () => {
      expect(() => parseExpr("let x = catch e -> 0 in x")).toThrow(/catch must follow a pipeline \|>/);
    });
  });

  describe("match expressions", () => {
    it("parses match on literals", () => {
      const ast = parseExpr("match x { 1 -> true, 2 -> false }");
      expect(ast).toMatchObject({
        kind: "Match",
        subject: { kind: "Ident", name: "x" },
        cases: [
          { pattern: { kind: "IntPat", value: 1 }, body: { kind: "BoolLit", value: true } },
          { pattern: { kind: "IntPat", value: 2 }, body: { kind: "BoolLit", value: false } },
        ],
      });
    });

    it("parses match with wildcard", () => {
      const ast = parseExpr("match x { 1 -> true, _ -> false }");
      expect(ast.kind).toBe("Match");
      if (ast.kind === "Match") {
        expect(ast.cases[1].pattern.kind).toBe("WildcardPat");
      }
    });

    it("parses match with tag patterns", () => {
      const ast = parseExpr("match s { Circle(r) -> r, Rect(w, h) -> w }");
      expect(ast).toMatchObject({
        kind: "Match",
        cases: [
          { pattern: { kind: "TagPat", tag: "Circle", args: [{ kind: "IdentPat", name: "r" }] } },
          { pattern: { kind: "TagPat", tag: "Rect", args: [{ kind: "IdentPat", name: "w" }, { kind: "IdentPat", name: "h" }] } },
        ],
      });
    });

    it("parses match with identifier patterns (binding)", () => {
      const ast = parseExpr("match x { n -> n + 1 }");
      expect(ast).toMatchObject({
        kind: "Match",
        cases: [{ pattern: { kind: "IdentPat", name: "n" } }],
      });
    });

    it("parses match with tuple pattern", () => {
      const ast = parseExpr("match pair { (x, y) -> x + y }");
      expect(ast).toMatchObject({
        kind: "Match",
        cases: [
          {
            pattern: {
              kind: "TuplePat",
              elements: [
                { kind: "IdentPat", name: "x" },
                { kind: "IdentPat", name: "y" },
              ],
            },
          },
        ],
      });
    });

    it("parses match with grouped pattern in parens", () => {
      const ast = parseExpr("match x { (n) -> n }");
      expect(ast).toMatchObject({
        kind: "Match",
        cases: [{ pattern: { kind: "IdentPat", name: "n" } }],
      });
    });

    it("parses match with boolean patterns", () => {
      const ast = parseExpr("match b { true -> 1, false -> 0 }");
      expect(ast).toMatchObject({
        kind: "Match",
        cases: [
          { pattern: { kind: "BoolPat", value: true } },
          { pattern: { kind: "BoolPat", value: false } },
        ],
      });
    });
  });

  describe("data structures", () => {
    it("parses list literals", () => {
      const ast = parseExpr("[1, 2, 3]");
      expect(ast).toMatchObject({
        kind: "List",
        elements: [{ value: 1 }, { value: 2 }, { value: 3 }],
      });
    });

    it("parses empty list", () => {
      const ast = parseExpr("[]");
      expect(ast).toMatchObject({ kind: "List", elements: [] });
    });

    it("parses tuples", () => {
      const ast = parseExpr('(1, "hello")');
      expect(ast).toMatchObject({
        kind: "Tuple",
        elements: [{ kind: "IntLit", value: 1 }, { kind: "StringLit", value: "hello" }],
      });
    });

    it("parses record literals", () => {
      const ast = parseExpr('{ name: "Alice", age: 30 }');
      expect(ast).toMatchObject({
        kind: "Record",
        fields: [
          { name: "name", value: { kind: "StringLit", value: "Alice" } },
          { name: "age", value: { kind: "IntLit", value: 30 } },
        ],
      });
    });

    it("parses record field punning", () => {
      const ast = parseExpr("{ total, responded }");
      expect(ast).toMatchObject({
        kind: "Record",
        fields: [
          { name: "total", value: { kind: "Ident", name: "total" } },
          { name: "responded", value: { kind: "Ident", name: "responded" } },
        ],
      });
    });

    it("parses mixed punned and explicit record fields", () => {
      const ast = parseExpr("{ total, count: 2 }");
      expect(ast).toMatchObject({
        kind: "Record",
        fields: [
          { name: "total", value: { kind: "Ident", name: "total" } },
          { name: "count", value: { kind: "IntLit", value: 2 } },
        ],
      });
    });

    it("parses field access", () => {
      const ast = parseExpr("user.name");
      expect(ast).toMatchObject({
        kind: "FieldAccess",
        expr: { kind: "Ident", name: "user" },
        field: "name",
      });
    });

    it("parses tagged values", () => {
      const ast = parseExpr("Ok(42)");
      expect(ast).toMatchObject({
        kind: "Tag",
        tag: "Ok",
        args: [{ kind: "IntLit", value: 42 }],
      });
    });

    it("parses tags with no args", () => {
      const ast = parseExpr("None");
      expect(ast).toMatchObject({ kind: "Tag", tag: "None", args: [] });
    });

    it("parses nested tags", () => {
      const ast = parseExpr("Ok(Some(5))");
      expect(ast).toMatchObject({
        kind: "Tag", tag: "Ok",
        args: [{ kind: "Tag", tag: "Some", args: [{ kind: "IntLit", value: 5 }] }],
      });
    });
  });

  describe("complete programs", () => {
    it("parses a pipeline with error handling", () => {
      const ast = parseExpr(`
        let process = fn(input) ->
          input
          |> parse_int?
          |> fn n -> n * 2
          |> catch e -> 0
        in process("42")
      `);
      expect(ast.kind).toBe("Let");
    });

    it("parses a match on tagged unions", () => {
      const ast = parseExpr(`
        let area = fn(s) -> match s {
          Circle(r) -> 3.14 * r * r,
          Rect(w, h) -> w * h
        }
        in area(Circle(5.0))
      `);
      expect(ast.kind).toBe("Let");
    });

    it("parses nested function calls with partial application", () => {
      const ast = parseExpr(`
        let result = [1, 2, 3, 4, 5]
          |> filter(fn(x) -> x > 2)
          |> map(fn(x) -> x * 10)
        in result
      `);
      expect(ast.kind).toBe("Let");
    });

    it("parses record operations", () => {
      const ast = parseExpr(`
        let user = { name: "Alice", age: 30 }
        in user.name
      `);
      expect(ast).toMatchObject({
        kind: "Let",
        body: { kind: "FieldAccess", field: "name" },
      });
    });
  });

  describe("if/then/else", () => {
    it("parses if/then/else into an If node", () => {
      const ast = parseExpr("if true then 1 else 2");
      expect(ast).toMatchObject({
        kind: "If",
        cond: { kind: "BoolLit", value: true },
        then: { kind: "IntLit", value: 1 },
        else_: { kind: "IntLit", value: 2 },
      });
    });

    it("parses a complex condition expression", () => {
      const ast = parseExpr('if x > 2 then "big" else "small"');
      expect(ast).toMatchObject({
        kind: "If",
        cond: { kind: "BinOp", op: ">" },
        then: { kind: "StringLit", value: "big" },
        else_: { kind: "StringLit", value: "small" },
      });
    });

    it("parses chained else-if naturally", () => {
      const ast = parseExpr("if a then 1 else if b then 2 else 3");
      expect(ast).toMatchObject({
        kind: "If",
        cond: { kind: "Ident", name: "a" },
        then: { kind: "IntLit", value: 1 },
        else_: {
          kind: "If",
          cond: { kind: "Ident", name: "b" },
          then: { kind: "IntLit", value: 2 },
          else_: { kind: "IntLit", value: 3 },
        },
      });
    });

    it("parses if as a let value and in a let body", () => {
      const ast = parseExpr("let x = if c then 1 else 2 in x");
      expect(ast).toMatchObject({
        kind: "Let",
        value: { kind: "If" },
        body: { kind: "Ident", name: "x" },
      });
    });

    // Branches parse greedily (parseExpr(0)), so a trailing pipe binds
    // INSIDE the else branch — same as let-in bodies. Use parens to pipe
    // the whole if: (if c then a else b) |> f.
    it("binds a trailing pipe inside the else branch", () => {
      const ast = parseExpr("if c then a else b |> f");
      expect(ast).toMatchObject({
        kind: "If",
        then: { kind: "Ident", name: "a" },
        else_: {
          kind: "Pipe",
          left: { kind: "Ident", name: "b" },
          right: { kind: "Ident", name: "f" },
        },
      });
    });

    it("pipes the whole if when parenthesized", () => {
      const ast = parseExpr("(if c then a else b) |> f");
      expect(ast).toMatchObject({
        kind: "Pipe",
        left: { kind: "If" },
        right: { kind: "Ident", name: "f" },
      });
    });

    it("rejects if without else with a positioned error", () => {
      expect(() => parseExpr("if true then 1")).toThrow(
        /Expected 'else'.*line 1, col 15/
      );
    });

    it("explains that if is an expression when else is missing", () => {
      expect(() => parseExpr("if true then 1")).toThrow(/'if' is an expression/);
    });

    it("rejects if without then with a positioned error", () => {
      expect(() => parseExpr("if true 1 else 2")).toThrow(
        /Expected 'then' after if condition.*line 1, col 9/
      );
    });

    it("gives the then-error for C-style if with braces", () => {
      expect(() => parseExpr("if x { 1 } else { 2 }")).toThrow(
        /Expected 'then' after if condition/
      );
    });
  });
});
