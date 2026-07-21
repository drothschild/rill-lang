import { Token, TokenKind } from "./token";
import { Expr, Declaration } from "./ast";
import { Span } from "./span";
import { Type, freshTypeVar } from "./types";

export function parse(tokens: Token[]): Expr {
  const parser = new Parser(tokens);
  const expr = parser.parseExpr(0);
  parser.expect(TokenKind.EOF);
  return expr;
}

export interface RuleParam {
  name: string;
  type: Type;
}

export interface RuleHeader {
  name: string;
  params: RuleParam[];
  returnType: Type | null;
}

export interface Program {
  declarations: Declaration[];
  header: RuleHeader | null;
  body: Expr;
}

// Parse a whole rule file: an optional `rule name(params) -> Type` header
// followed by the body expression. Headerless sources parse exactly as parse().
export function parseProgram(tokens: Token[]): Program {
  const parser = new Parser(tokens);
  const header = parser.at(TokenKind.Rule) ? parser.parseRuleHeader() : null;
  const body = parser.parseExpr(0);
  parser.expect(TokenKind.EOF);
  return { declarations: [], header, body };
}

class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  peek(): Token {
    return this.tokens[this.pos];
  }

  advance(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  expect(kind: TokenKind): Token {
    const token = this.peek();
    if (token.kind !== kind) {
      throw new Error(`Expected ${kind} but got ${token.kind} at line ${token.span.start.line}, col ${token.span.start.col}`);
    }
    return this.advance();
  }

  at(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  // A binder is an identifier or _ (a wildcard the body cannot reference,
  // since _ is not a valid expression).
  expectBinder(): string {
    const token = this.peek();
    if (token.kind !== TokenKind.Ident && token.kind !== TokenKind.Underscore) {
      throw new Error(`Expected Ident or _ but got ${token.kind} at line ${token.span.start.line}, col ${token.span.start.col}`);
    }
    return this.advance().lexeme;
  }

  eat(kind: TokenKind): Token | null {
    if (this.at(kind)) return this.advance();
    return null;
  }

  spanFrom(start: Span): Span {
    const prev = this.tokens[this.pos - 1] || this.peek();
    return { start: start.start, end: prev.span.end };
  }

  parseExpr(minBp: number): Expr {
    let left = this.nud();
    while (true) {
      // Postfix ? (Try operator)
      if (this.at(TokenKind.Question) && POSTFIX_BP >= minBp) {
        const qToken = this.advance();
        left = { kind: "Try", expr: left, span: { start: left.span.start, end: qToken.span.end } };
        continue;
      }
      // Postfix call: any expression followed by ( is a function application
      if (this.at(TokenKind.LParen) && POSTFIX_BP >= minBp) {
        left = this.parseCallArgs(left);
        continue;
      }
      const token = this.peek();
      const bp = infixBp(token.kind);
      if (bp === null || bp[0] < minBp) break;
      left = this.led(left, bp);
    }
    return left;
  }

  nud(): Expr {
    const token = this.peek();

    switch (token.kind) {
      case TokenKind.Int: {
        this.advance();
        return { kind: "IntLit", value: parseInt(token.lexeme, 10), span: token.span };
      }
      case TokenKind.Float: {
        this.advance();
        return { kind: "FloatLit", value: parseFloat(token.lexeme), span: token.span };
      }
      case TokenKind.String: {
        this.advance();
        const value = token.lexeme.slice(1, -1);
        return { kind: "StringLit", value, span: token.span };
      }
      case TokenKind.True: {
        this.advance();
        return { kind: "BoolLit", value: true, span: token.span };
      }
      case TokenKind.False: {
        this.advance();
        return { kind: "BoolLit", value: false, span: token.span };
      }
      case TokenKind.Ident: {
        this.advance();
        return { kind: "Ident", name: token.lexeme, span: token.span };
      }
      // Let binding
      case TokenKind.Let: {
        return this.parseLet();
      }
      // Function literal
      case TokenKind.Fn: {
        return this.parseFn();
      }
      // Match expression
      case TokenKind.Match: {
        return this.parseMatch();
      }
      // If expression
      case TokenKind.If: {
        return this.parseIf();
      }
      // List literal
      case TokenKind.LBracket: {
        const lbracket = this.advance();
        const elements: Expr[] = [];
        if (!this.at(TokenKind.RBracket)) {
          elements.push(this.parseExpr(0));
          while (this.eat(TokenKind.Comma)) {
            elements.push(this.parseExpr(0));
          }
        }
        const rbracket = this.expect(TokenKind.RBracket);
        return { kind: "List", elements, span: { start: lbracket.span.start, end: rbracket.span.end } };
      }
      // Catch expression — only valid as the right-hand side of |> (see led)
      case TokenKind.Catch: {
        throw new Error(`catch must follow a pipeline |> at line ${token.span.start.line}, col ${token.span.start.col}`);
      }
      // Unary operators
      case TokenKind.Bang: {
        this.advance();
        const expr = this.parseExpr(PREFIX_BP);
        return { kind: "UnaryOp", op: "!", expr, span: this.spanFrom(token.span) };
      }
      case TokenKind.Minus: {
        this.advance();
        const expr = this.parseExpr(PREFIX_BP);
        return { kind: "UnaryOp", op: "-", expr, span: this.spanFrom(token.span) };
      }
      // Parenthesized expression or tuple
      case TokenKind.LParen: {
        const lparen = this.advance();
        if (this.at(TokenKind.RParen)) {
          const rparen = this.advance();
          return { kind: "UnitLit", span: { start: lparen.span.start, end: rparen.span.end } };
        }
        const first = this.parseExpr(0);
        if (this.eat(TokenKind.Comma)) {
          // It's a tuple
          const elements: Expr[] = [first];
          elements.push(this.parseExpr(0));
          while (this.eat(TokenKind.Comma)) {
            elements.push(this.parseExpr(0));
          }
          const rparen = this.expect(TokenKind.RParen);
          return { kind: "Tuple", elements, span: { start: lparen.span.start, end: rparen.span.end } };
        }
        // It's grouping
        this.expect(TokenKind.RParen);
        return first;
      }
      // Record literal
      case TokenKind.LBrace: {
        const lbrace = this.advance();
        const fields: { name: string; value: Expr }[] = [];
        if (!this.at(TokenKind.RBrace)) {
          fields.push(this.parseRecordField());
          while (this.eat(TokenKind.Comma)) {
            if (this.at(TokenKind.RBrace)) break;
            fields.push(this.parseRecordField());
          }
        }
        const rbrace = this.expect(TokenKind.RBrace);
        return { kind: "Record", fields, span: { start: lbrace.span.start, end: rbrace.span.end } };
      }
      // Tagged values (UpperIdent)
      case TokenKind.UpperIdent: {
        this.advance();
        const tag = token.lexeme;
        const args: Expr[] = [];
        if (this.at(TokenKind.LParen)) {
          this.advance();
          if (!this.at(TokenKind.RParen)) {
            args.push(this.parseExpr(0));
            while (this.eat(TokenKind.Comma)) {
              args.push(this.parseExpr(0));
            }
          }
          this.expect(TokenKind.RParen);
        }
        const endSpan = args.length > 0 ? args[args.length - 1].span : token.span;
        return { kind: "Tag", tag, args, span: { start: token.span.start, end: this.tokens[this.pos - 1].span.end } };
      }
      default:
        throw new Error(`Unexpected token ${token.kind} ("${token.lexeme}") at line ${token.span.start.line}, col ${token.span.start.col}`);
    }
  }

  parseLet(): Expr {
    const letToken = this.expect(TokenKind.Let);
    const rec = !!this.eat(TokenKind.Rec);
    const name = this.expectBinder();
    this.expect(TokenKind.Eq);
    const value = this.parseExpr(0);
    // 'in' is optional: without it, the rest of the enclosing expression is
    // the body, so 'let x = e1 let y = e2 result' desugars to the same
    // nested Let nodes as 'let x = e1 in let y = e2 in result'.
    this.eat(TokenKind.In);
    const body = this.parseExpr(0);
    return {
      kind: "Let",
      name,
      value,
      body,
      rec,
      span: { start: letToken.span.start, end: body.span.end },
    };
  }

  parseRecordField(): { name: string; value: Expr } {
    const nameToken = this.expect(TokenKind.Ident);
    if (this.eat(TokenKind.Colon)) {
      return { name: nameToken.lexeme, value: this.parseExpr(0) };
    }
    // Punned field: { total } desugars to { total: total }
    return {
      name: nameToken.lexeme,
      value: { kind: "Ident", name: nameToken.lexeme, span: nameToken.span },
    };
  }

  parseFn(): Expr {
    const fnToken = this.expect(TokenKind.Fn);
    const params: string[] = [];
    if (this.eat(TokenKind.LParen)) {
      // fn(a, b) -> ...
      if (!this.at(TokenKind.RParen)) {
        params.push(this.expectBinder());
        while (this.eat(TokenKind.Comma)) {
          params.push(this.expectBinder());
        }
      }
      this.expect(TokenKind.RParen);
    } else {
      // fn x -> ... (shorthand single param)
      params.push(this.expectBinder());
    }
    this.expect(TokenKind.Arrow);
    // Stop fn body before pipe operator so pipes stay at the outer level
    // |> has left bp 5, so using minBp 6 stops before consuming pipes
    const body = this.parseExpr(6);

    // Desugar multi-param into nested Fn nodes (right to left)
    let result: Expr = body;
    for (let i = params.length - 1; i >= 1; i--) {
      result = {
        kind: "Fn",
        param: params[i],
        body: result,
        span: { start: fnToken.span.start, end: body.span.end },
      };
    }
    return {
      kind: "Fn",
      param: params[0] || "_",
      body: result,
      span: { start: fnToken.span.start, end: body.span.end },
    };
  }

  parseCallArgs(fn: Expr): Expr {
    this.expect(TokenKind.LParen);
    const args: Expr[] = [];
    if (!this.at(TokenKind.RParen)) {
      args.push(this.parseExpr(0));
      while (this.eat(TokenKind.Comma)) {
        args.push(this.parseExpr(0));
      }
    }
    const rparen = this.expect(TokenKind.RParen);

    // Desugar multi-arg call into nested Call nodes
    let result: Expr = fn;
    for (const arg of args) {
      result = {
        kind: "Call",
        fn: result,
        arg,
        span: { start: fn.span.start, end: rparen.span.end },
      };
    }
    return result;
  }

  parseRuleHeader(): RuleHeader {
    this.expect(TokenKind.Rule);
    const name = this.expect(TokenKind.Ident).lexeme;
    this.expect(TokenKind.LParen);
    const params: RuleParam[] = [];
    if (!this.at(TokenKind.RParen)) {
      params.push(this.parseRuleParam());
      while (this.eat(TokenKind.Comma)) {
        if (this.at(TokenKind.RParen)) break; // trailing comma
        params.push(this.parseRuleParam());
      }
    }
    this.expect(TokenKind.RParen);
    let returnType: Type | null = null;
    if (this.eat(TokenKind.Arrow)) {
      returnType = this.parseTypeAnn();
    }
    return { name, params, returnType };
  }

  parseRuleParam(): RuleParam {
    const name = this.expect(TokenKind.Ident).lexeme;
    this.expect(TokenKind.Colon);
    return { name, type: this.parseTypeAnn() };
  }

  parseTypeAnn(): Type {
    const token = this.peek();
    switch (token.kind) {
      case TokenKind.UpperIdent: {
        this.advance();
        switch (token.lexeme) {
          case "Int": case "Float": case "String": case "Bool": case "Unit":
            return { kind: "TCon", name: token.lexeme };
          case "List": {
            this.expect(TokenKind.LParen);
            const element = this.parseTypeAnn();
            this.expect(TokenKind.RParen);
            return { kind: "TList", element };
          }
          case "Result": {
            this.expect(TokenKind.LParen);
            const ok = this.parseTypeAnn();
            this.expect(TokenKind.RParen);
            return { kind: "TResult", ok };
          }
          default:
            throw new Error(`Unknown type name '${token.lexeme}' at line ${token.span.start.line}, col ${token.span.start.col} (expected Int, Float, String, Bool, Unit, List(..), Result(..), a record type, or a tuple type)`);
        }
      }
      // Record type: { field: Type, .. } — trailing `..` marks an open row
      case TokenKind.LBrace: {
        this.advance();
        const fields = new Map<string, Type>();
        let rest: Type | null = null;
        while (!this.at(TokenKind.RBrace)) {
          if (this.eat(TokenKind.DotDot)) {
            rest = freshTypeVar();
            this.eat(TokenKind.Comma);
            break;
          }
          const fieldName = this.expect(TokenKind.Ident).lexeme;
          this.expect(TokenKind.Colon);
          fields.set(fieldName, this.parseTypeAnn());
          if (!this.eat(TokenKind.Comma)) break;
        }
        this.expect(TokenKind.RBrace);
        return { kind: "TRecord", fields, rest };
      }
      // Tuple type: (A, B, ...) — single parens are grouping
      case TokenKind.LParen: {
        this.advance();
        const first = this.parseTypeAnn();
        if (this.eat(TokenKind.Comma)) {
          const elements: Type[] = [first, this.parseTypeAnn()];
          while (this.eat(TokenKind.Comma)) {
            elements.push(this.parseTypeAnn());
          }
          this.expect(TokenKind.RParen);
          return { kind: "TTuple", elements };
        }
        this.expect(TokenKind.RParen);
        return first;
      }
      default:
        throw new Error(`Expected a type annotation but got ${token.kind} ("${token.lexeme}") at line ${token.span.start.line}, col ${token.span.start.col}`);
    }
  }

  parseCatch(): Expr {
    const catchToken = this.expect(TokenKind.Catch);
    const errorName = this.expectBinder();
    this.expect(TokenKind.Arrow);
    // Stop the fallback before pipe operator so pipes stay at the outer level,
    // same convention as fn bodies (|> has left bp 5, so minBp 6 stops before pipes)
    const fallback = this.parseExpr(6);
    return {
      kind: "Catch",
      expr: { kind: "UnitLit", span: catchToken.span } as Expr, // placeholder — pipe fills in actual expr
      errorName,
      fallback,
      span: { start: catchToken.span.start, end: fallback.span.end },
    };
  }

  parseMatch(): Expr {
    const matchToken = this.expect(TokenKind.Match);
    const subject = this.parseExpr(0);
    this.expect(TokenKind.LBrace);
    const cases: { pattern: import("./ast").Pattern; body: Expr }[] = [];
    if (!this.at(TokenKind.RBrace)) {
      cases.push(this.parseMatchCase());
      while (this.eat(TokenKind.Comma)) {
        if (this.at(TokenKind.RBrace)) break; // trailing comma
        cases.push(this.parseMatchCase());
      }
    }
    const rbrace = this.expect(TokenKind.RBrace);
    return {
      kind: "Match",
      subject,
      cases,
      span: { start: matchToken.span.start, end: rbrace.span.end },
    };
  }

  parseMatchCase(): { pattern: import("./ast").Pattern; body: Expr } {
    const pattern = this.parsePattern();
    this.expect(TokenKind.Arrow);
    const body = this.parseExpr(0);
    return { pattern, body };
  }

  parseIf(): Expr {
    const ifToken = this.expect(TokenKind.If);
    const cond = this.parseExpr(0);
    if (!this.at(TokenKind.Then)) {
      const t = this.peek();
      throw new Error(`Expected 'then' after if condition, but got ${t.kind} at line ${t.span.start.line}, col ${t.span.start.col}`);
    }
    this.advance();
    // Branches parse greedily (minBp 0), so a trailing |> binds inside the
    // else branch — same as let-in bodies. Parenthesize the if to pipe its result.
    const then = this.parseExpr(0);
    if (!this.at(TokenKind.Else)) {
      const t = this.peek();
      throw new Error(`Expected 'else' after then-branch ('if' is an expression, so else is required), but got ${t.kind} at line ${t.span.start.line}, col ${t.span.start.col}`);
    }
    this.advance();
    const else_ = this.parseExpr(0);
    return {
      kind: "If",
      cond,
      then,
      else_,
      span: { start: ifToken.span.start, end: else_.span.end },
    };
  }

  parsePattern(): import("./ast").Pattern {
    const token = this.peek();

    switch (token.kind) {
      case TokenKind.Int: {
        this.advance();
        return { kind: "IntPat", value: parseInt(token.lexeme, 10) };
      }
      case TokenKind.Float: {
        this.advance();
        return { kind: "FloatPat", value: parseFloat(token.lexeme) };
      }
      case TokenKind.String: {
        this.advance();
        return { kind: "StringPat", value: token.lexeme.slice(1, -1) };
      }
      case TokenKind.True: {
        this.advance();
        return { kind: "BoolPat", value: true };
      }
      case TokenKind.False: {
        this.advance();
        return { kind: "BoolPat", value: false };
      }
      case TokenKind.Underscore: {
        this.advance();
        return { kind: "WildcardPat" };
      }
      case TokenKind.LParen: {
        this.advance();
        const first = this.parsePattern();
        if (this.eat(TokenKind.Comma)) {
          const elements: import("./ast").Pattern[] = [first];
          elements.push(this.parsePattern());
          while (this.eat(TokenKind.Comma)) {
            elements.push(this.parsePattern());
          }
          this.expect(TokenKind.RParen);
          return { kind: "TuplePat", elements };
        }
        this.expect(TokenKind.RParen);
        return first;
      }
      case TokenKind.UpperIdent: {
        this.advance();
        const tag = token.lexeme;
        const args: import("./ast").Pattern[] = [];
        if (this.eat(TokenKind.LParen)) {
          if (!this.at(TokenKind.RParen)) {
            args.push(this.parsePattern());
            while (this.eat(TokenKind.Comma)) {
              args.push(this.parsePattern());
            }
          }
          this.expect(TokenKind.RParen);
        }
        return { kind: "TagPat", tag, args };
      }
      case TokenKind.Ident: {
        this.advance();
        return { kind: "IdentPat", name: token.lexeme };
      }
      default:
        throw new Error(`Unexpected pattern token ${token.kind} at line ${token.span.start.line}, col ${token.span.start.col}`);
    }
  }

  led(left: Expr, bp: [number, number]): Expr {
    const opToken = this.advance();

    // Field access
    if (opToken.kind === TokenKind.Dot) {
      const field = this.expect(TokenKind.Ident);
      return {
        kind: "FieldAccess",
        expr: left,
        field: field.lexeme,
        span: { start: left.span.start, end: field.span.end },
      };
    }

    // Pipe operator creates Pipe node, not BinOp
    if (opToken.kind === TokenKind.Pipe) {
      const right = this.at(TokenKind.Catch) ? this.parseCatch() : this.parseExpr(bp[1]);
      return {
        kind: "Pipe",
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }

    const op = tokenToOp(opToken.kind);
    const right = this.parseExpr(bp[1]);
    return {
      kind: "BinOp",
      op,
      left,
      right,
      span: { start: left.span.start, end: right.span.end },
    };
  }
}

const PREFIX_BP = 80;
const POSTFIX_BP = 90;

// Returns [left binding power, right binding power]
// Left < right means left-associative
function infixBp(kind: TokenKind): [number, number] | null {
  switch (kind) {
    case TokenKind.Pipe: return [5, 6];
    case TokenKind.PipePipe: return [10, 11];
    case TokenKind.AmpAmp: return [20, 21];
    case TokenKind.EqEq:
    case TokenKind.BangEq: return [30, 31];
    case TokenKind.Lt:
    case TokenKind.Gt:
    case TokenKind.LtEq:
    case TokenKind.GtEq: return [40, 41];
    case TokenKind.PlusPlus: return [50, 51];
    case TokenKind.Plus:
    case TokenKind.Minus: return [60, 61];
    case TokenKind.Star:
    case TokenKind.Slash:
    case TokenKind.Percent: return [70, 71];
    case TokenKind.Dot: return [95, 96];
    default: return null;
  }
}

function tokenToOp(kind: TokenKind): string {
  switch (kind) {
    case TokenKind.Plus: return "+";
    case TokenKind.Minus: return "-";
    case TokenKind.Star: return "*";
    case TokenKind.Slash: return "/";
    case TokenKind.Percent: return "%";
    case TokenKind.PlusPlus: return "++";
    case TokenKind.EqEq: return "==";
    case TokenKind.BangEq: return "!=";
    case TokenKind.Lt: return "<";
    case TokenKind.Gt: return ">";
    case TokenKind.LtEq: return "<=";
    case TokenKind.GtEq: return ">=";
    case TokenKind.AmpAmp: return "&&";
    case TokenKind.PipePipe: return "||";
    default: throw new Error(`Unknown operator token: ${kind}`);
  }
}
