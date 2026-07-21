import { describe, it, expect } from "vitest";
import { lex } from "./lexer";
import { TokenKind } from "./token";

function kinds(source: string): TokenKind[] {
  return lex(source).map((t) => t.kind);
}

function lexemes(source: string): string[] {
  return lex(source).filter((t) => t.kind !== TokenKind.EOF).map((t) => t.lexeme);
}

describe("Lexer", () => {
  describe("literals", () => {
    it("lexes integers", () => {
      expect(kinds("42")).toEqual([TokenKind.Int, TokenKind.EOF]);
      expect(lexemes("42")).toEqual(["42"]);
    });

    it("lexes floats", () => {
      expect(kinds("3.14")).toEqual([TokenKind.Float, TokenKind.EOF]);
    });

    it("lexes strings", () => {
      expect(kinds('"hello"')).toEqual([TokenKind.String, TokenKind.EOF]);
      expect(lexemes('"hello"')).toEqual(['"hello"']);
    });

    it("lexes booleans", () => {
      expect(kinds("true false")).toEqual([TokenKind.True, TokenKind.False, TokenKind.EOF]);
    });

    it("lexes unit", () => {
      expect(kinds("()")).toEqual([TokenKind.LParen, TokenKind.RParen, TokenKind.EOF]);
    });
  });

  describe("identifiers and keywords", () => {
    it("lexes identifiers", () => {
      expect(kinds("foo bar_baz")).toEqual([TokenKind.Ident, TokenKind.Ident, TokenKind.EOF]);
    });

    it("lexes keywords", () => {
      expect(kinds("let rec fn match catch in")).toEqual([
        TokenKind.Let, TokenKind.Rec, TokenKind.Fn, TokenKind.Match,
        TokenKind.Catch, TokenKind.In, TokenKind.EOF,
      ]);
    });

    it("lexes type, alias, import keywords", () => {
      expect(kinds("type alias import")).toEqual([
        TokenKind.Type, TokenKind.Alias, TokenKind.Import, TokenKind.EOF,
      ]);
    });

    it("lexes uppercase identifiers as UpperIdent", () => {
      expect(kinds("Ok Err Circle")).toEqual([
        TokenKind.UpperIdent, TokenKind.UpperIdent, TokenKind.UpperIdent, TokenKind.EOF,
      ]);
    });
  });

  describe("operators", () => {
    it("lexes arithmetic operators", () => {
      expect(kinds("+ - * / %")).toEqual([
        TokenKind.Plus, TokenKind.Minus, TokenKind.Star,
        TokenKind.Slash, TokenKind.Percent, TokenKind.EOF,
      ]);
    });

    it("lexes comparison operators", () => {
      expect(kinds("== != < > <= >=")).toEqual([
        TokenKind.EqEq, TokenKind.BangEq, TokenKind.Lt, TokenKind.Gt,
        TokenKind.LtEq, TokenKind.GtEq, TokenKind.EOF,
      ]);
    });

    it("lexes logical operators", () => {
      expect(kinds("&& || !")).toEqual([
        TokenKind.AmpAmp, TokenKind.PipePipe, TokenKind.Bang, TokenKind.EOF,
      ]);
    });

    it("lexes Rill-specific operators", () => {
      expect(kinds("|> ++ -> ?")).toEqual([
        TokenKind.Pipe, TokenKind.PlusPlus, TokenKind.Arrow, TokenKind.Question, TokenKind.EOF,
      ]);
    });

    it("lexes = vs ==", () => {
      expect(kinds("= ==")).toEqual([TokenKind.Eq, TokenKind.EqEq, TokenKind.EOF]);
    });
  });

  describe("delimiters", () => {
    it("lexes all delimiters", () => {
      expect(kinds("( ) { } [ ] , . : _")).toEqual([
        TokenKind.LParen, TokenKind.RParen, TokenKind.LBrace, TokenKind.RBrace,
        TokenKind.LBracket, TokenKind.RBracket, TokenKind.Comma, TokenKind.Dot,
        TokenKind.Colon, TokenKind.Underscore, TokenKind.EOF,
      ]);
    });
  });

  describe("comments", () => {
    it("skips line comments", () => {
      expect(kinds("42 -- this is a comment\n5")).toEqual([
        TokenKind.Int, TokenKind.Int, TokenKind.EOF,
      ]);
    });
  });

  describe("whitespace", () => {
    it("skips whitespace", () => {
      expect(kinds("  42   5  ")).toEqual([TokenKind.Int, TokenKind.Int, TokenKind.EOF]);
    });
  });

  describe("source spans", () => {
    it("tracks token positions", () => {
      const tokens = lex("let x = 42");
      const let_ = tokens[0];
      expect(let_.span.start).toEqual({ line: 1, col: 1, offset: 0 });
      expect(let_.span.end).toEqual({ line: 1, col: 4, offset: 3 });

      const x = tokens[1];
      expect(x.span.start).toEqual({ line: 1, col: 5, offset: 4 });

      const num = tokens[3];
      expect(num.span.start).toEqual({ line: 1, col: 9, offset: 8 });
      expect(num.span.end).toEqual({ line: 1, col: 11, offset: 10 });
    });

    it("tracks positions across lines", () => {
      const tokens = lex("let x = 1\nlet y = 2");
      const y = tokens.find((t) => t.lexeme === "y")!;
      expect(y.span.start.line).toBe(2);
      expect(y.span.start.col).toBe(5);
    });
  });

  describe("string escapes", () => {
    it("lexes an escaped double quote without terminating the string", () => {
      const source = '"he said \\"hi\\""';
      expect(kinds(source)).toEqual([TokenKind.String, TokenKind.EOF]);
      expect(lexemes(source)).toEqual(['"he said "hi""']);
    });

    it("decodes \\n, \\t, \\r and \\\\ into the lexeme", () => {
      const tokens = lex('"a\\nb\\tc\\rd\\\\e"');
      expect(tokens[0].kind).toBe(TokenKind.String);
      expect(tokens[0].lexeme).toBe('"a\nb\tc\rd\\e"');
    });

    it("rejects unknown escape sequences with a position", () => {
      expect(() => lex('"a\\qb"')).toThrow();
      try {
        lex('"a\\qb"');
      } catch (e: any) {
        expect(e.message).toContain("escape");
        expect(e.message).toContain("\\q");
        expect(e.message).toContain("line 1");
        expect(e.message).toContain("col 3");
      }
    });

    it("treats a trailing backslash as an unterminated string", () => {
      expect(() => lex('"abc\\')).toThrow("unterminated string");
    });

    it("still rejects raw newlines inside strings", () => {
      expect(() => lex('"a\nb"')).toThrow("unterminated string");
    });
  });

  describe("lexer errors", () => {
    it("reports unexpected characters with position", () => {
      expect(() => lex("let x = @")).toThrow();
      try {
        lex("let x = @");
      } catch (e: any) {
        expect(e.message).toContain("line 1");
        expect(e.message).toContain("col 9");
      }
    });

    it("reports unterminated strings", () => {
      expect(() => lex('"hello')).toThrow();
      try {
        lex('"hello');
      } catch (e: any) {
        expect(e.message).toContain("unterminated string");
      }
    });
  });

  describe("complete programs", () => {
    it("lexes a let binding with function", () => {
      const tokens = lex("let add = fn(a, b) -> a + b");
      const expected = [
        TokenKind.Let, TokenKind.Ident, TokenKind.Eq, TokenKind.Fn,
        TokenKind.LParen, TokenKind.Ident, TokenKind.Comma, TokenKind.Ident,
        TokenKind.RParen, TokenKind.Arrow, TokenKind.Ident, TokenKind.Plus,
        TokenKind.Ident, TokenKind.EOF,
      ];
      expect(kinds("let add = fn(a, b) -> a + b")).toEqual(expected);
    });

    it("lexes a pipeline with ? operator", () => {
      expect(kinds('input |> parse_int? |> catch e -> 0')).toEqual([
        TokenKind.Ident, TokenKind.Pipe, TokenKind.Ident, TokenKind.Question,
        TokenKind.Pipe, TokenKind.Catch, TokenKind.Ident, TokenKind.Arrow,
        TokenKind.Int, TokenKind.EOF,
      ]);
    });

    it("lexes a record literal", () => {
      expect(kinds('{ name: "Alice", age: 30 }')).toEqual([
        TokenKind.LBrace, TokenKind.Ident, TokenKind.Colon, TokenKind.String,
        TokenKind.Comma, TokenKind.Ident, TokenKind.Colon, TokenKind.Int,
        TokenKind.RBrace, TokenKind.EOF,
      ]);
    });

    it("lexes a match expression with tags", () => {
      expect(kinds("match s { Circle(r) -> r }")).toEqual([
        TokenKind.Match, TokenKind.Ident, TokenKind.LBrace,
        TokenKind.UpperIdent, TokenKind.LParen, TokenKind.Ident, TokenKind.RParen,
        TokenKind.Arrow, TokenKind.Ident, TokenKind.RBrace, TokenKind.EOF,
      ]);
    });
  });
});
