// Library API exports for embedding Rill as a rule engine
export { evaluate } from './evaluator';
export { createPrelude } from './prelude';
export { lex } from './lexer';
export { parse } from './parser';
export { Value, prettyPrint } from './values';
export { runSource } from './runner';

// Load-time type-checking API for embedders.
export { infer, createPreludeTypeEnv, bindType } from './typechecker';
export type { TypeEnv } from './typechecker';
export { T } from './types';
export type { Type } from './types';
