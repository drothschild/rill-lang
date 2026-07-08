import { Token, TokenKind } from "./token";
import { Span } from "./span";

const KEYWORDS: Record<string, TokenKind> = {
  let: TokenKind.Let,
  rec: TokenKind.Rec,
  fn: TokenKind.Fn,
  match: TokenKind.Match,
  catch: TokenKind.Catch,
  in: TokenKind.In,
  if: TokenKind.If,
  then: TokenKind.Then,
  else: TokenKind.Else,
  true: TokenKind.True,
  false: TokenKind.False,
};

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function peek(): string {
    return pos < source.length ? source[pos] : "\0";
  }

  function peekNext(): string {
    return pos + 1 < source.length ? source[pos + 1] : "\0";
  }

  function advance(): string {
    const ch = source[pos];
    pos++;
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function makeSpan(startLine: number, startCol: number, startOffset: number): Span {
    return {
      start: { line: startLine, col: startCol, offset: startOffset },
      end: { line, col, offset: pos },
    };
  }

  function emit(kind: TokenKind, lexeme: string, startLine: number, startCol: number, startOffset: number) {
    tokens.push({ kind, lexeme, span: makeSpan(startLine, startCol, startOffset) });
  }

  function skipWhitespace() {
    while (pos < source.length) {
      const ch = peek();
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        advance();
      } else if (ch === "-" && peekNext() === "-") {
        // Line comment
        while (pos < source.length && peek() !== "\n") {
          advance();
        }
      } else {
        break;
      }
    }
  }

  function readString(): string {
    const startLine = line;
    const startCol = col;
    const startOffset = pos;
    advance(); // opening "
    let value = '"';
    while (pos < source.length && peek() !== '"') {
      if (peek() === "\n") {
        throw new Error(`unterminated string at line ${startLine}, col ${startCol}`);
      }
      if (peek() === "\\") {
        const escLine = line;
        const escCol = col;
        advance(); // backslash
        if (pos >= source.length || peek() === "\n") {
          throw new Error(`unterminated string at line ${startLine}, col ${startCol}`);
        }
        const esc = advance();
        switch (esc) {
          case "\\": value += "\\"; break;
          case '"': value += '"'; break;
          case "n": value += "\n"; break;
          case "t": value += "\t"; break;
          case "r": value += "\r"; break;
          default:
            throw new Error(`Unknown escape sequence '\\${esc}' at line ${escLine}, col ${escCol}`);
        }
        continue;
      }
      value += advance();
    }
    if (pos >= source.length) {
      throw new Error(`unterminated string at line ${startLine}, col ${startCol}`);
    }
    value += advance(); // closing "
    return value;
  }

  function readNumber(): { lexeme: string; isFloat: boolean } {
    let lexeme = "";
    while (pos < source.length && isDigit(peek())) {
      lexeme += advance();
    }
    if (peek() === "." && isDigit(peekNext())) {
      lexeme += advance(); // .
      while (pos < source.length && isDigit(peek())) {
        lexeme += advance();
      }
      return { lexeme, isFloat: true };
    }
    return { lexeme, isFloat: false };
  }

  function readIdentifier(): string {
    let lexeme = "";
    while (pos < source.length && isAlphaNumeric(peek())) {
      lexeme += advance();
    }
    return lexeme;
  }

  while (pos < source.length) {
    skipWhitespace();
    if (pos >= source.length) break;

    const startLine = line;
    const startCol = col;
    const startOffset = pos;
    const ch = peek();

    // Numbers
    if (isDigit(ch)) {
      const { lexeme, isFloat } = readNumber();
      emit(isFloat ? TokenKind.Float : TokenKind.Int, lexeme, startLine, startCol, startOffset);
      continue;
    }

    // Strings
    if (ch === '"') {
      const lexeme = readString();
      emit(TokenKind.String, lexeme, startLine, startCol, startOffset);
      continue;
    }

    // Standalone underscore (wildcard) vs identifier starting with _
    if (ch === "_" && !isAlphaNumeric(peekNext())) {
      advance();
      emit(TokenKind.Underscore, "_", startLine, startCol, startOffset);
      continue;
    }

    // Identifiers and keywords
    if (isAlpha(ch)) {
      const lexeme = readIdentifier();
      const keyword = KEYWORDS[lexeme];
      if (keyword !== undefined) {
        emit(keyword, lexeme, startLine, startCol, startOffset);
      } else if (lexeme[0] >= "A" && lexeme[0] <= "Z") {
        emit(TokenKind.UpperIdent, lexeme, startLine, startCol, startOffset);
      } else {
        emit(TokenKind.Ident, lexeme, startLine, startCol, startOffset);
      }
      continue;
    }

    // Two-character operators
    const twoChar = ch + peekNext();
    if (twoChar === "|>") { advance(); advance(); emit(TokenKind.Pipe, "|>", startLine, startCol, startOffset); continue; }
    if (twoChar === "||") { advance(); advance(); emit(TokenKind.PipePipe, "||", startLine, startCol, startOffset); continue; }
    if (twoChar === "++") { advance(); advance(); emit(TokenKind.PlusPlus, "++", startLine, startCol, startOffset); continue; }
    if (twoChar === "->") { advance(); advance(); emit(TokenKind.Arrow, "->", startLine, startCol, startOffset); continue; }
    if (twoChar === "==") { advance(); advance(); emit(TokenKind.EqEq, "==", startLine, startCol, startOffset); continue; }
    if (twoChar === "!=") { advance(); advance(); emit(TokenKind.BangEq, "!=", startLine, startCol, startOffset); continue; }
    if (twoChar === "<=") { advance(); advance(); emit(TokenKind.LtEq, "<=", startLine, startCol, startOffset); continue; }
    if (twoChar === ">=") { advance(); advance(); emit(TokenKind.GtEq, ">=", startLine, startCol, startOffset); continue; }
    if (twoChar === "&&") { advance(); advance(); emit(TokenKind.AmpAmp, "&&", startLine, startCol, startOffset); continue; }

    // Single-character tokens
    advance();
    switch (ch) {
      case "+": emit(TokenKind.Plus, "+", startLine, startCol, startOffset); break;
      case "-": emit(TokenKind.Minus, "-", startLine, startCol, startOffset); break;
      case "*": emit(TokenKind.Star, "*", startLine, startCol, startOffset); break;
      case "/": emit(TokenKind.Slash, "/", startLine, startCol, startOffset); break;
      case "%": emit(TokenKind.Percent, "%", startLine, startCol, startOffset); break;
      case "=": emit(TokenKind.Eq, "=", startLine, startCol, startOffset); break;
      case "<": emit(TokenKind.Lt, "<", startLine, startCol, startOffset); break;
      case ">": emit(TokenKind.Gt, ">", startLine, startCol, startOffset); break;
      case "!": emit(TokenKind.Bang, "!", startLine, startCol, startOffset); break;
      case "?": emit(TokenKind.Question, "?", startLine, startCol, startOffset); break;
      case "(": emit(TokenKind.LParen, "(", startLine, startCol, startOffset); break;
      case ")": emit(TokenKind.RParen, ")", startLine, startCol, startOffset); break;
      case "{": emit(TokenKind.LBrace, "{", startLine, startCol, startOffset); break;
      case "}": emit(TokenKind.RBrace, "}", startLine, startCol, startOffset); break;
      case "[": emit(TokenKind.LBracket, "[", startLine, startCol, startOffset); break;
      case "]": emit(TokenKind.RBracket, "]", startLine, startCol, startOffset); break;
      case ",": emit(TokenKind.Comma, ",", startLine, startCol, startOffset); break;
      case ".": emit(TokenKind.Dot, ".", startLine, startCol, startOffset); break;
      case ":": emit(TokenKind.Colon, ":", startLine, startCol, startOffset); break;
      case "_": emit(TokenKind.Underscore, "_", startLine, startCol, startOffset); break;
      default:
        throw new Error(`Unexpected character '${ch}' at line ${startLine}, col ${startCol}`);
    }
  }

  const endSpan = makeSpan(line, col, pos);
  tokens.push({ kind: TokenKind.EOF, lexeme: "", span: endSpan });
  return tokens;
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isAlphaNumeric(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}
