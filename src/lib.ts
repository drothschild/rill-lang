// Library API exports for embedding Rill as a rule engine
export { evaluate, evaluateProgram } from './evaluator';
export { createPrelude } from './prelude';
export { lex } from './lexer';
export { parse, parseProgram } from './parser';
export type { Program, RuleHeader, RuleParam } from './parser';
export { checkRuleSource } from './rules';
export type { RuleCheckResult } from './rules';
export { Value, prettyPrint } from './values';
export { runSource } from './runner';

// Load-time type-checking API for embedders.
export { infer, createPreludeTypeEnv, bindType } from './typechecker';
export type { TypeEnv } from './typechecker';
export { T } from './types';
export type { Type } from './types';
