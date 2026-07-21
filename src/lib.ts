// Library API exports for embedding Rill as a rule engine
export { evaluate, evaluateProgram } from './evaluator';
export { createPrelude } from './prelude';
export { lex } from './lexer';
export { parse, parseProgram } from './parser';
export type { Program, RuleHeader, RuleParam } from './parser';
export { checkRuleSource } from './rules';
export type { RuleCheckResult, CheckRuleOptions } from './rules';
export { Value, prettyPrint } from './values';
export { runSource, createFsResolver } from './runner';

// Module system API for embedders.
export type { Resolver } from './modules';

// Load-time type-checking API for embedders.
export { infer, createPreludeTypeEnv, bindType } from './typechecker';
export type { TypeEnv } from './typechecker';
export { T } from './types';
export type { Type } from './types';

// Bridge API for JS↔Rill conversion (Phase 5)
export { rillToJs, jsToRill, BridgeError } from './bridge';
export { createPreludeDeclEnv } from './decls';
export type { DeclEnv } from './decls';

// Engine API for state machine dispatch (Phase 5)
export { createEngine, TransitionError } from './engine';
export type { Engine, EngineConfig } from './engine';
