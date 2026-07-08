import { Span } from "./span";

export enum TokenKind {
  // Literals
  Int = "Int",
  Float = "Float",
  String = "String",
  True = "True",
  False = "False",

  // Keywords
  Let = "Let",
  Rec = "Rec",
  Fn = "Fn",
  Match = "Match",
  Catch = "Catch",
  In = "In",
  If = "If",
  Then = "Then",
  Else = "Else",

  // Identifiers
  Ident = "Ident",
  UpperIdent = "UpperIdent",

  // Operators
  Plus = "Plus",
  Minus = "Minus",
  Star = "Star",
  Slash = "Slash",
  Percent = "Percent",
  PlusPlus = "PlusPlus",
  Eq = "Eq",
  EqEq = "EqEq",
  BangEq = "BangEq",
  Lt = "Lt",
  Gt = "Gt",
  LtEq = "LtEq",
  GtEq = "GtEq",
  AmpAmp = "AmpAmp",
  PipePipe = "PipePipe",
  Bang = "Bang",
  Arrow = "Arrow",
  Pipe = "Pipe",
  Question = "Question",

  // Delimiters
  LParen = "LParen",
  RParen = "RParen",
  LBrace = "LBrace",
  RBrace = "RBrace",
  LBracket = "LBracket",
  RBracket = "RBracket",
  Comma = "Comma",
  Dot = "Dot",
  Colon = "Colon",
  Underscore = "Underscore",

  // Special
  EOF = "EOF",
}

export interface Token {
  kind: TokenKind;
  lexeme: string;
  span: Span;
}
