# Rill language core

Last verified: 2026-07-02

## Purpose
Rill is a small pure-functional expression language embedded as a rule engine
by host apps (e.g. rill-job-tracker). This dir holds the lexer, parser, type
inferencer, and evaluator.

## Contracts
- **Public API is `lib.ts` only.** Everything exported from `lib.ts` is the
  supported embedding surface; anything else is internal and may change without
  notice.
- **Exposes** (`lib.ts`): runtime (`lex`, `parse`, `evaluate`, `runSource`,
  `createPrelude`, `Value`, `prettyPrint`) and the load-time type-check API
  (`infer`, `createPreludeTypeEnv`, `bindType`, `TypeEnv`, and the `T`
  constructor namespace + `Type` for building declared signatures).
- **`Scheme` is intentionally NOT exported** — it is opaque to embedders.
  Build environments via `createPreludeTypeEnv()` + `bindType(env, name, type)`,
  never by constructing schemes directly.
- **Expects**: to type-check a program, call `infer(ast, env, source)` — passing
  `source` is what makes errors source-located.

## Invariants
- **Prelude typing distinguishes list vs string length**: `length : List(a) -> Int`
  and `str_len : String -> Int` are separate builtins. `length(aString)` is a
  type error under `infer`; use `str_len` for string length.
- **Open vs closed records (Leijen scoped-label rows)**: field access on an OPEN
  record grows its row to include the field; access of a missing field on a
  CLOSED record throws a source-located `RillError` ("No field X in record").
  `T.record(fields)` is closed; `T.record(fields, true)` is open.

## Key Files
- `lib.ts` - the public API boundary (start here)
- `typechecker.ts` - `infer`, `createPreludeTypeEnv`, `bindType`; record row logic
- `unify.ts` - row-variable record unification
- `prelude.ts` - runtime builtins (must stay in sync with prelude types)

## Gotchas
- Adding a prelude builtin requires updating BOTH `prelude.ts` (runtime) and
  `createPreludeTypeEnv()` in `typechecker.ts` (its type), or checked code and
  run code disagree.
- `dist/` is the built output embedders import; rebuild it after changing exports.
