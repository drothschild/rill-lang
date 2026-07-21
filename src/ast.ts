import { Span } from "./span";
import { Type } from "./types";

// ── Declarations ─────────────────────────────────────────

export interface ConstructorDef {
  name: string;
  payload: Type | null;
  span: Span;
}

export interface TypeDecl {
  kind: "TypeDecl";
  name: string;
  params: string[];
  constructors: ConstructorDef[];
  span: Span;
}

export interface AliasDecl {
  kind: "AliasDecl";
  name: string;
  params: string[];
  type: Type;
  span: Span;
}

export type Declaration = TypeDecl | AliasDecl;

// ── Expressions ──────────────────────────────────────────

export type Expr =
  | IntLit
  | FloatLit
  | StringLit
  | BoolLit
  | UnitLit
  | Ident
  | Let
  | Fn
  | Call
  | BinOp
  | UnaryOp
  | Pipe
  | Try
  | Catch
  | Match
  | If
  | List
  | Tuple
  | Record
  | FieldAccess
  | Tag;

export interface IntLit { kind: "IntLit"; value: number; span: Span }
export interface FloatLit { kind: "FloatLit"; value: number; span: Span }
export interface StringLit { kind: "StringLit"; value: string; span: Span }
export interface BoolLit { kind: "BoolLit"; value: boolean; span: Span }
export interface UnitLit { kind: "UnitLit"; span: Span }
export interface Ident { kind: "Ident"; name: string; span: Span }

export interface Let {
  kind: "Let";
  name: string;
  value: Expr;
  body: Expr;
  rec: boolean;
  span: Span;
}

export interface Fn {
  kind: "Fn";
  param: string;
  body: Expr;
  span: Span;
}

export interface Call {
  kind: "Call";
  fn: Expr;
  arg: Expr;
  span: Span;
}

export interface BinOp {
  kind: "BinOp";
  op: string;
  left: Expr;
  right: Expr;
  span: Span;
}

export interface UnaryOp {
  kind: "UnaryOp";
  op: string;
  expr: Expr;
  span: Span;
}

export interface Pipe {
  kind: "Pipe";
  left: Expr;
  right: Expr;
  span: Span;
}

export interface Try {
  kind: "Try";
  expr: Expr;
  span: Span;
}

export interface Catch {
  kind: "Catch";
  expr: Expr;
  errorName: string;
  fallback: Expr;
  span: Span;
}

export interface Match {
  kind: "Match";
  subject: Expr;
  cases: MatchCase[];
  span: Span;
}

export interface MatchCase {
  pattern: Pattern;
  body: Expr;
}

export interface If {
  kind: "If";
  cond: Expr;
  then: Expr;
  else_: Expr;
  span: Span;
}

export interface List {
  kind: "List";
  elements: Expr[];
  span: Span;
}

export interface Tuple {
  kind: "Tuple";
  elements: Expr[];
  span: Span;
}

export interface Record {
  kind: "Record";
  fields: { name: string; value: Expr }[];
  span: Span;
}

export interface FieldAccess {
  kind: "FieldAccess";
  expr: Expr;
  field: string;
  span: Span;
}

export interface Tag {
  kind: "Tag";
  tag: string;
  args: Expr[];
  span: Span;
}

// ── Patterns ─────────────────────────────────────────────

export type Pattern =
  | IntPat
  | FloatPat
  | StringPat
  | BoolPat
  | WildcardPat
  | IdentPat
  | TagPat
  | TuplePat
  | RecordPat;

export interface IntPat { kind: "IntPat"; value: number }
export interface FloatPat { kind: "FloatPat"; value: number }
export interface StringPat { kind: "StringPat"; value: string }
export interface BoolPat { kind: "BoolPat"; value: boolean }
export interface WildcardPat { kind: "WildcardPat" }
export interface IdentPat { kind: "IdentPat"; name: string }
export interface TagPat { kind: "TagPat"; tag: string; args: Pattern[] }
export interface TuplePat { kind: "TuplePat"; elements: Pattern[] }
export interface RecordPat { kind: "RecordPat"; fields: { name: string; pattern: Pattern }[] }
