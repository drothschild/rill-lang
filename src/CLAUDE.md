# Rill language core

Last verified: 2026-07-21

## Purpose
Rill is a small pure-functional expression language embedded as a rule engine
by host apps (e.g. rill-job-tracker). This dir holds the lexer, parser, type
inferencer, evaluator, and state machine engine.

## Contracts
- **Public API is `lib.ts` only.** Everything exported from `lib.ts` is the
  supported embedding surface; anything else is internal and may change without
  notice.
- **Exposes** (`lib.ts`): runtime (`lex`, `parse`, `evaluate`, `runSource`,
  `createPrelude`, `Value`, `prettyPrint`); load-time type-check API
  (`infer`, `createPreludeTypeEnv`, `bindType`, `TypeEnv`, and the `T`
  constructor namespace + `Type`); canonical JS↔Rill bridge (`jsToRill`,
  `rillToJs`, `BridgeError`); and state machine engine (`createEngine`,
  `TransitionError`, `Engine`, `EngineConfig`).
- **`Scheme` is intentionally NOT exported** — it is opaque to embedders.
  Build environments via `createPreludeTypeEnv()` + `bindType(env, name, type)`,
  never by constructing schemes directly.
- **Expects**: to type-check a program, call `infer(ast, env, source)` — passing
  `source` is what makes errors source-located.

## Bridge Conventions (Phase 5 — jsToRill / rillToJs)

**Outbound (`rillToJs`, value-directed):**
- Tag with no payload: `{ tag: "Resting" }` (discriminated union convention)
- Tag with payload: `{ tag: "ScheduleRest", value: {...} }` (single-arg)
- Option: `Some(x)` → unwrapped `x`; `None` → `undefined`
- Records → plain objects (fields recursively converted)
- Lists → arrays; Int/Float → number; String/Bool → string/boolean; Unit → null

**Inbound (`jsToRill(value, declaredType, declEnv, fieldPath)`, type-directed):**
- Declared `Int`: `42` → Int; `42.5` → error naming field path
- Declared `Float`: `42` → `42.0` (coerces integers); `42.5` → Float
- Declared `Option(T)`: `undefined/null` → `None`; present → `Some(converted T)`
- **Nested `Option(Option(a))` unsupported** — throws clear "unsupported at the bridge" error
- Declared union: expects `{ tag: string, value?: unknown }`; tag validated; payload converted; did-you-mean on mismatch
- Declared record: object; missing non-Option field → error naming it; extra keys ignored
- Declared `List(T)`: array, elementwise with `[i]` paths
- Boundary errors thread field paths through recursion: `"event.rpe"`, `"state.entries[2].reps"`

## Engine Contract (Phase 5 — createEngine / dispatch)

**Configuration:**
```typescript
interface EngineConfig<State, Event> {
  resolve: (path: string) => string;  // module resolver
  entry: string;                      // entry rule path
  initialState: State;
  executors: Record<string, (payload: unknown) => void | Promise<void>>;
  onExecutorError?: (err: unknown, effectTag: string) => void;
}
```

**Entry rule shape (validated at construction):**
`rule name(state: StateType, event: EventType) -> Result({ state: StateType, effects: List(EffectType) })`
- Exactly 2 parameters, positional: param 0 is state, param 1 is event
- Return type must be `Result(record)` where record has `state` and `effects` fields

**Dispatch semantics:**
- `dispatch(event: Event): State` is synchronous and returns the new state
- Inputs: current state and event converted via `jsToRill` against header types
- Evaluation: rule body evaluated with (state, event) bound by parameter NAME
- **Ok path**: new state converted via `rillToJs`, internal state SWAPPED FIRST, then executors invoked in effect-list order; missing executor → TransitionError (state already swapped)
- **Err path**: `TransitionError` thrown with Err message; state NOT swapped; no executors run
- **Async executor semantics**: invoked synchronously but fire-and-forget; rejections routed to `onExecutorError` callback; if no callback, rethrown on microtask queue (unhandled-rejection visible); sync executor throws propagate out of dispatch (state remains swapped)

## Module Resolver Contract (Phase 4)

**Resolver function:**
```typescript
type Resolver = (path: string, fromPath?: string) => string;
```
- Takes an import path and optional current module path
- Returns the source code content of the imported module
- Used at load-time to resolve `import` declarations
- Entry rule source is loaded via `resolve(config.entry)`

## Declaration-Only Module Files (Phase 4 Design Decision)

Modules may contain only type and alias declarations with no body expression:
```
import h from "helpers"
type Status = Active | Inactive
alias Config = { name: String, level: Int }
```
These modules export their type/alias declarations for use by other modules. No runtime behavior; no let bindings required.

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
- `engine.ts` - `createEngine`, `TransitionError`, dispatch logic
- `bridge.ts` - `jsToRill`, `rillToJs`, field-path boundary errors
- `modules.ts` - `loadModules`, `buildGraphDeclEnv`, module evaluation
- `typechecker.ts` - `infer`, `createPreludeTypeEnv`, `bindType`; record row logic
- `unify.ts` - row-variable record unification
- `prelude.ts` - runtime builtins (must stay in sync with prelude types)

## Gotchas
- Adding a prelude builtin requires updating BOTH `prelude.ts` (runtime) and
  `createPreludeTypeEnv()` in `typechecker.ts` (its type), or checked code and
  run code disagree.
- `dist/` is the built output embedders import; rebuild it after changing exports.
- Nested Option types (`Option(Option(a))`) are not supported at the bridge — they
  throw an error if encountered during type-directed conversion.
