# Rill State Language Design

## Summary
Rill is currently a small, statically-typed functional rules language — Hindley-Milner inference plus row-polymorphic records — embedded inside two TypeScript host applications (HMBWorkout and rill-job-tracker) and hard-checked against in-file `rule` headers before each host boots. Its data model today leans on ad hoc "structural tags" and sentinel values (e.g. `rpe: -1.0`) to represent state and absence, which pushes indexing, composition, and validity logic out into host-side TypeScript. This design pivots Rill from that structural-tag model to a state-oriented language with declared algebraic data types: a `type` declaration for unions (with plain and payload-carrying constructors), an `alias` form for named record types, and a `match` construct the typechecker now checks for exhaustiveness (following Gleam's decision-tree coverage algorithm), so every phase and event a state machine can be in must be handled or the load gate fails. Around that core, the design adds targeted ergonomic features — Elm-style record update syntax, a bounds-checked list-indexing builtin, and an `Option` type that replaces sentinels — plus a module/import system so rules can be split across files with host-pluggable path resolution.

The approach is a clean break rather than an additive one: structural tags are removed outright, and `Result`/`Option` move from typechecker special cases into ordinary prelude-declared unions, so the "old" Result-based error handling and the "new" state/event unions are checked the same way. To validate the design against real usage rather than a toy example, the plan requires migrating both existing consumers onto the new language — rewriting HMBWorkout's hand-rolled transition logic and rill-job-tracker's stage rules — behind characterization tests that pin current behavior first, so the migrations are verifiable refactors rather than rewrites. A canonical JS↔Rill bridge and a generalized `createEngine` dispatch loop are extracted into rill-lang itself (replacing near-duplicate code in both consumers), converting values across the boundary using each rule's declared types instead of guessing from JS runtime values. Implementation proceeds in seven phases — type declarations, exhaustiveness/guards, expression ergonomics, modules, the bridge/engine, consumer migrations, and documentation — with the type-system-defining early phases done in dialogue rather than delegated to a fleet of agents, since they set precedent for everything that follows.

## Definition of Done

1. A committed design document specifying Rill's evolution into a state-oriented rules language: record update syntax, list indexing, absence handling (Option or similar), declared union types with exhaustive typed match (events + phases), a module/import system, and a canonical JS bridge + engine-loop helpers exported from rill-lang.
2. Migration of both consumers is part of the design's acceptance criteria: HMBWorkout's `transition.lv` rewritten in the new language (dramatically shorter, exhaustiveness-checked, no sentinels, no host-side `idx` pre-indexing, no string-concat composition) and rill-job-tracker's 4 rules migrated, with both boot gates still hard-failing on bad rules.
3. Portfolio deliverable: the design is written so the interview docs (deep dive, Q-bank, collaboration note) can be updated with the state-language chapter after implementation.

Exact feature shapes (syntax, which absence mechanism, etc.) are decided during brainstorming — the Definition of Done locks the scope, not the solutions.

**Context notes (from clarification):**
- Priorities: ergonomics/readability first, safety second. Runtime performance is not a goal.
- Breaking changes to Rill syntax are acceptable; rill-job-tracker is migrated alongside.
- The 2026-07-07 "wart-driven only" principle is relaxed for this design: the state-language pivot itself justifies features designed for anticipated state-machine needs, not only observed warts.

## Acceptance Criteria

### rill-state-lang.AC1: Declared unions with exhaustive typed match
- **rill-state-lang.AC1.1 Success:** A `type` declaration with plain and payload constructors parses, and its constructors are usable in expressions and patterns with correct payload types.
- **rill-state-lang.AC1.2 Success:** `alias` names a record type usable in rule headers and other declarations; aliased and inline-structural forms unify.
- **rill-state-lang.AC1.3 Failure:** An undeclared constructor (`Circl(2.0)`) is a source-located load-time error with a did-you-mean suggestion.
- **rill-state-lang.AC1.4 Success:** `Ok`/`Err`/`Some`/`None` work as ordinary prelude constructors; `?` and `catch` behave exactly as before on `Result`; existing `-> Result({...})` headers check unchanged.
- **rill-state-lang.AC1.5 Failure:** A `match` on a declared union missing a constructor fails the load gate, listing every missing constructor by name.
- **rill-state-lang.AC1.6 Failure:** Accessing a payload field from the wrong constructor's arm (`p.reps` in a `PauseSession` arm) is a load-time type error.
- **rill-state-lang.AC1.7 Success:** A guarded arm (`| RestElapsed(p) if p.nowMs >= d ->`) evaluates the guard with pattern bindings in scope; guard false falls through to the next arm.
- **rill-state-lang.AC1.8 Failure:** A match whose only coverage of a constructor is a guarded arm fails exhaustiveness; a `?` inside a guard is a parse/check error.

### rill-state-lang.AC2: Record update
- **rill-state-lang.AC2.1 Success:** `{ state | phase: Resting, setIndex: 0 }` produces a copy with only those fields changed; all other fields preserved (including row-polymorphic bases in helper functions).
- **rill-state-lang.AC2.2 Failure:** Updating a field absent from the base record is a load-time error; so is assigning a value of a different type than the field.

### rill-state-lang.AC3: List indexing
- **rill-state-lang.AC3.1 Success:** `at(2, xs)` returns `Ok` of the element; composes with `?` and `|>`.
- **rill-state-lang.AC3.2 Failure:** Out-of-bounds and negative indices return `Err` naming the index (no crash).

### rill-state-lang.AC4: Absence via Option
- **rill-state-lang.AC4.1 Success:** `Option(a)` fields typecheck in aliases/headers; `Some`/`None` match exhaustively.
- **rill-state-lang.AC4.2 Success:** `with_default` and `map_option` behave per signature.
- **rill-state-lang.AC4.3 Success:** Prelude runtime and type-env registrations agree (consistency test covers every builtin).

### rill-state-lang.AC5: Module system
- **rill-state-lang.AC5.1 Success:** `import "path" as h` resolves via a host-provided resolver; `h.func(...)` calls work; imported types/constructors are usable unqualified.
- **rill-state-lang.AC5.2 Failure:** An import cycle fails at load time with the full cycle path in the error; a type error inside an imported helper fails the importing entry rule's check, located in the helper's source.
- **rill-state-lang.AC5.3 Success:** Diamond imports load the shared module once (no duplicate-declaration errors).
- **rill-state-lang.AC5.4 Failure:** Two imported modules declaring the same type/constructor name is a load-time collision error.

### rill-state-lang.AC6: Canonical bridge and engine
- **rill-state-lang.AC6.1 Success:** Constructors round-trip JS↔Rill as `{ tag, value? }` discriminated unions; `None` ↔ `undefined`/absent field; `Some(x)` ↔ unwrapped `x`.
- **rill-state-lang.AC6.2 Success/Failure:** Inbound JS `42` into a declared `Float` param becomes `42.0`; JS `42.5` into an `Int` param is rejected with an error naming the field.
- **rill-state-lang.AC6.3 Success:** `createEngine.dispatch` swaps state and runs the matching executor per effect tag on `Ok`; preserves state and throws `TransitionError` on `Err`.

### rill-state-lang.AC7: Consumer migrations
- **rill-state-lang.AC7.1 Success:** Migrated HMBWorkout engine reproduces the pinned characterization behavior (state + effects per scripted event sequence, modulo the documented sentinel→Option table); `transition.lv` contains no full-record re-spelling, no sentinels, and the host contains no `idx` pre-injection or effect enrichment.
- **rill-state-lang.AC7.2 Success:** rill-job-tracker's 4 migrated rules produce identical outputs on their existing fixtures; `transitions.lv` uses a declared `Stage` union.
- **rill-state-lang.AC7.3 Failure:** A deliberately broken rule (non-exhaustive match) causes `process.exit(1)` at tracker boot and `RuleErrorScreen` in HMBWorkout.

### rill-state-lang.AC8: Documentation
- **rill-state-lang.AC8.1 Success:** README documents all new syntax and the structural-tag removal; every `examples/*.lv` runs under the new language with re-pinned outputs.
- **rill-state-lang.AC8.2 Success:** Deep dive, collab note, and Q-bank each gained state-language content dated after implementation.

## Glossary

**Domain terms (this codebase)**
- **Rill**: The embedded functional rules language this document evolves — a small expression-oriented language, statically typed, currently used to encode state-transition/business rules inside TypeScript hosts.
- **`rule` header**: An in-file type signature (e.g. `-> Result({...})`) declaring a Rill rule's expected shape; `checkRuleSource` validates rule bodies against these headers as a hard load-time gate.
- **Boot gate / load-time error**: Validation that runs when the host application starts, not per-call at runtime; a failing check prevents the app from booting rather than throwing during normal operation.
- **Structural tags / `TagValue`**: Rill's current (pre-design) mechanism where a bare identifier like `Resting` is inferred as an ad hoc tag rather than checked against a declared type — the thing this design replaces with declared unions.
- **Sentinel value**: An in-band placeholder (e.g. `rpe: -1.0`, `prePausePhase: ""`) used today to encode "no value," which this design replaces with `Option`.
- **HMBWorkout / rill-job-tracker**: Rill's two consumer applications (a workout tracker and a job tracker); their rule files are the two migration targets this design's acceptance criteria require.
- **`.lv` file**: A Rill source file.
- **Prelude**: Rill's built-in standard library of types and functions (`Result`, `Option`, `at`, etc.), registered separately in the runtime (`src/prelude.ts`) and the typechecker (`createPreludeTypeEnv`) and kept in sync by a consistency test.
- **Bridge (`jsToRill` / `rillToJs`)**: The conversion layer at the TypeScript-host/Rill boundary, translating JS values into Rill's internal representation and back.
- **`createEngine`**: A new library-level helper generalizing HMBWorkout's existing dispatch loop (event in, updated state + effects out) so both consumers share one implementation instead of copy-pasting it.
- **Effects-as-data**: A pattern where side effects (e.g. "schedule a rest timer") are returned as plain data from a rule rather than performed directly, then carried out by a host-side executor afterward.
- **Characterization test**: A test written against an implementation's *current* behavior before changing it, so a later refactor/migration can be verified as behavior-preserving.

**Third-party concepts and prior art**
- **Hindley-Milner (HM) inference**: The classic algorithm for inferring types in a functional language without requiring explicit annotations everywhere; Rill's typechecker is built on it.
- **Row polymorphism (Leijen-style)**: A way of typing records so a function can accept "any record with at least these fields" without fixing its exact shape, keeping Rill's records open yet type-checked.
- **Algebraic data type (ADT) / declared union**: A type built from named alternative "constructors" (optionally carrying payload data), e.g. `type Phase = Idle | Warmup | Working` — the core new type-system feature.
- **Exhaustiveness checking**: A typechecker guarantee that a `match` handles every constructor of a union, catching missing cases at load time instead of at runtime.
- **Discriminated union**: The JSON-side encoding of a Rill union value as `{ tag: "...", value?: ... }`, letting host code branch on the `tag` field.
- **`Option`/`Maybe` type**: A standard FP type representing "a value or its absence" (`Some(x)` / `None`), replacing sentinels here.
- **`Result` type**: A standard FP type representing "success or a named failure" (`Ok(x)` / `Err(msg)`), Rill's existing error-handling mechanism.
- **Elm**: A statically-typed functional UI language; this design borrows its exhaustive-union model, record-update syntax, and "Elm architecture" effects pattern.
- **Gleam**: A statically-typed functional language on the BEAM VM; referenced for its exhaustiveness algorithm and Option-flattening bridge convention, both adopted here.
- **PureScript**: A Haskell-like language compiling to JS; referenced for its record-update restriction (an update can't change a field's type), adopted here.
- **ReScript**: A typed language compiling to JS; mentioned as the alternative structural-tag model considered and rejected in favor of Elm's approach.
- **Jules Jacobs' pattern-match compilation algorithm**: A published algorithm for checking pattern matches for exhaustiveness/usefulness, used by Gleam and adopted in this design.
- **Import cycle / diamond import**: Module-system terms — a cycle is A imports B imports A (an error here); a diamond is two modules both importing a shared third module (must load once, not error, here).

## Architecture

Rill evolves from a structural-tag rules language into a state-oriented language with declared algebraic data types, while keeping its core shape: a small expression-oriented functional language, Hindley-Milner inference with Leijen row-polymorphic records, embedded in TypeScript hosts, hard-checked at boot against in-file `rule` headers.

### Type system: clean-break declared ADTs

Two new top-level declaration forms (file-level, importable):

```
type Phase = Idle | Warmup | Working | Resting | Paused | Done

type Event =
  | StartSession({ sessionId: String, routine: Routine, nowMs: Int })
  | LogSet({ reps: Int, weightKg: Float, durationSeconds: Int, rpe: Option(Float) })
  | SetDone({ nowMs: Int })

alias SessionState = {
  sessionId: String,
  phase: Phase,
  lastLoggedSet: Option(LoggedSet),
  ...
}
```

- `type` declares a union with zero-or-payload constructors and optional type parameters. Constructor names are unique across all types in scope (Elm rule), which keeps `match` inference unambiguous.
- `alias` names a record type; aliases expand structurally to the existing `TRecord`, so row polymorphism and open records (`{ tag: String, .. }`) are unaffected.
- **Structural tags are removed** (clean break, per ReScript-vs-Elm evaluation — Elm model chosen). Every constructor must belong to a declared type; unknown constructors are load-time errors with did-you-mean suggestions.
- **Result and Option stop being typechecker special cases.** The prelude declares `type Result(a) = Ok(a) | Err(String)` and `type Option(a) = Some(a) | None`. The `?` operator and `catch` remain sugar tied to `Result` by name. Existing header syntax `-> Result({...})` is unchanged.
- `match` now unifies the subject against arm patterns and enforces **exhaustiveness** on declared unions (Jules Jacobs' pattern-match compilation algorithm, as used by Gleam). Missing constructors are listed by name in the error.
- **Match guards** (`| Pattern if expr -> body`) are re-admitted — the 2026-07-07 rejection predates match-centric dispatch; once event dispatch moves into `match`, per-event phase-validity checks are the wart guards fix. Guards are `Bool` expressions with pattern bindings in scope, may not use `?`, and guarded arms do not count toward exhaustiveness coverage.
- Runtime representation is unchanged: constructors evaluate to the existing `TagValue`. This is a parser/typechecker change, not an evaluator rewrite.

### Expression-level ergonomics

- **Record update** (Elm syntax, typed over existing rows): `{ state | phase: Resting, setIndex: 0 }`. The base record must contain every updated field; updates cannot change a field's type (PureScript restriction — field-wise unify, no row surgery). No nested-update sugar.
- **List indexing** via one prelude builtin, no Array type: `at : Int -> List(a) -> Result(a)`. Out-of-bounds/negative indices produce `Err` naming the index. Kills the `head(filter(fn(e) -> e.idx == i, xs))?` idiom and host-side `idx` pre-injection.
- **Absence** is always a value: `Option` replaces sentinels (`rpe: -1.0`, `prePausePhase: ""`). New prelude helpers: `with_default : a -> Option(a) -> a`, `map_option : (a -> b) -> Option(a) -> Option(b)`. No optional-field record syntax.

### Module system

One import form; resolution owned by the host:

```
import "workout/types" as t
import "workout/helpers" as h
```

- A module is a `.lv` file; its top-level `type`/`alias` declarations and `let` bindings are its exports (no privacy in v1).
- **Values are qualified** (`h.rest_duration(...)`); **types and constructors enter scope unqualified** on import (constructor names are globally unique; qualified constructors in match arms would destroy the ergonomics). Cross-module name collisions are load-time errors.
- **Resolver contract**: `checkRuleSource` and the evaluator accept a resolver `(path: string) => string`. CLI and rill-job-tracker plug in a filesystem resolver (relative to the importing file); HMBWorkout plugs in its bundled-strings map. This deletes `buildCompositeTransition()`.
- Import cycles are rejected at load time via the import stack, with the full cycle in the error. Diamond imports are fine (modules checked once, cached per load).
- `rule` headers remain entry-point-only; imported library modules are checked transitively, errors located in the module's own source.

### Canonical JS bridge and engine loop

The near-identical copy-pasted bridges in both consumers move into rill-lang's public API (`src/lib.ts`):

- `jsToRill` / `rillToJs` exported once. Constructors cross as discriminated unions: `Resting` ↔ `{ tag: "Resting" }`, `ScheduleRest({deadlineMs})` ↔ `{ tag: "ScheduleRest", value: { deadlineMs } }`.
- **Option flattening** (Gleam convention): `None` ↔ `undefined` (absent inbound field accepted), `Some(x)` ↔ `x` unwrapped. Nested `Option(Option(a))` unsupported at the bridge (documented).
- **Type-directed number conversion** replaces per-value guessing: inbound values are converted against the rule header's declared parameter types — a `Float` field accepts JS `42` producing `42.0`; an `Int` field rejects `42.5` with a located boundary error naming the field. Guess-based classification survives only in the REPL.
- **`createEngine`** joins the API — the generalized HMBWorkout dispatch loop:

```typescript
interface EngineConfig<State, Event> {
  resolve: (path: string) => string;        // module resolver
  entry: string;                            // entry rule path
  initialState: State;
  executors: Record<string, (payload: unknown) => void | Promise<void>>;  // keyed by Effect tag
}
interface Engine<State, Event> {
  dispatch(event: Event): State;            // runs transition; Ok swaps state + runs effects; Err throws TransitionError, state preserved
  getState(): State;
}
```

Effects are declared in-language (`type Effect = CreateSession | ScheduleRest({ deadlineMs: Int }) | ...`); the uniform `{kind, deadline_ms, message}` record convention and host-side enrichment are deleted. rill-job-tracker ignores `createEngine` and keeps `evaluateRule`, imported instead of copy-pasted.

### Consumer migrations

- **HMBWorkout** (`~/Projects/HMBWorkout/src/engine/`): rules split into `types.lv` (Phase/Event/Effect unions + record aliases), `helpers.lv` (validate_set, rest_duration), `transition.lv` (one exhaustive `match event` with guards). Projected ~389 → ~140–170 lines. Host deletions: `idx` pre-injection, effect enrichment, `buildCompositeTransition`, local bridge — replaced by `createEngine`. `RuleErrorScreen` boot-gate behavior preserved and now also catches non-exhaustive matches.
- **rill-job-tracker** (`~/Projects/rill-job-tracker/`): 4 stateless rules migrated. `validation.lv` require-chains untouched. `transitions.lv` becomes a declared `type Stage` union with exhaustive match (ADT payoff outside state machines). Local bridge replaced by rill-lang import; `process.exit(1)` boot gate unchanged.

## Existing Patterns

Investigation (rill-lang, rill-job-tracker, HMBWorkout; 2026-07-21) found these patterns, which this design builds on:

- **In-file `rule` headers + `checkRuleSource` load gate** (`src/rules.ts`) — the strongest existing feature; extended (resolver parameter, declared-type references in headers), not replaced. Both consumers' boot-gate styles preserved (`process.exit(1)` server gate; `RuleErrorScreen` throw).
- **Effects-as-data** — HMBWorkout's `(state, event) -> Result({state, effects})` loop is the Elm-architecture command pattern; `createEngine` generalizes it into the library rather than inventing a new shape.
- **Discriminated-union AST with exhaustive TS switches** — new `Expr`/`Type`/`Pattern` variants follow the existing add-variant-and-fix-switches workflow (`src/ast.ts`, `src/types.ts`).
- **Co-located tests + characterization pinning** — the 2026-07-07 in-file-headers migration landed behind characterization tests pinning byte-identical behavior; consumer migrations here follow the same pattern.
- **Prelude dual-registration** — builtins are registered in `src/prelude.ts` (runtime) and `createPreludeTypeEnv` (types); new builtins (`at`, `with_default`, `map_option`) follow it, plus a new consistency test guarding the sync.
- **`docs/design-plans/` convention** — adopted from rill-job-tracker into rill-lang (with a `.gitignore` carve-out, since `docs/` is otherwise local-only).

**Deliberate divergences:** structural tags are removed (was: undeclared `Tag` nodes inferred as `TTag`); `Result`/`Ok`/`Err` hardcoding in typechecker/evaluator is unwound into prelude declarations; the per-value number classification in both consumers' bridges is replaced by type-directed conversion. Each divergence is justified in Architecture.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: ADT core
**Goal:** Declared `type`/`alias`, constructor environment, match subject unification; Result/Option become prelude declarations.

**Components:**
- `src/token.ts`, `src/lexer.ts` — `type`, `alias`, `import` keywords (import parsed later)
- `src/parser.ts` — declaration parsing; `parseTypeAnn` extended to reference declared names
- `src/ast.ts` — `TypeDecl`/`AliasDecl` nodes; `Program` gains declarations
- `src/types.ts`, `src/unify.ts`, `src/typechecker.ts` — declared-union type (`TUnion` or evolved `TTag`), constructor env, match subject unification, unknown-constructor errors with suggestions; Result/Option de-special-cased; `?`/`catch` re-derived over declared Result
- `src/evaluator.ts` — constructor arity checking (runtime `TagValue` unchanged)

**Dependencies:** None (first phase). Highest blast radius — lands first with the full existing suite as a ratchet.

**Done when:** Declarations parse and check; `rill-state-lang.AC1.1–AC1.4` and `rill-state-lang.AC4.1` tests pass; full existing test suite green (adjusted only where structural-tag behavior was pinned).
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Exhaustiveness and guards
**Goal:** Exhaustive match on declared unions; match guards.

**Components:**
- `src/typechecker.ts` — coverage checking (Jacobs-style decision-tree usefulness), guarded arms excluded from coverage
- `src/parser.ts`, `src/ast.ts`, `src/evaluator.ts` — `if` guard clause on `MatchCase`; guards reject `?`
- Golden error-message tests (missing-constructor lists, guard fallback requirement)

**Dependencies:** Phase 1.

**Done when:** `rill-state-lang.AC1.5–AC1.8` tests pass, including deleting any guarded arm's fallback failing the check.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Expression ergonomics
**Goal:** Record update, `at`, Option helpers.

**Components:**
- `src/parser.ts`, `src/ast.ts` — `{ base | field: expr, ... }` form
- `src/typechecker.ts`, `src/unify.ts` — update typing (base contains fields; no field type change), unify-level tests against row interaction
- `src/evaluator.ts` — update evaluation (copy-with)
- `src/prelude.ts` + `createPreludeTypeEnv` — `at`, `with_default`, `map_option`; prelude sync consistency test

**Dependencies:** Phase 1 (Option for helpers). Independent of Phase 2.

**Done when:** `rill-state-lang.AC2.*`, `AC3.*`, `AC4.2–AC4.3` tests pass.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Module system
**Goal:** `import "path" as name` with host-pluggable resolution.

**Components:**
- `src/parser.ts`, `src/ast.ts` — import declarations
- New `src/modules.ts` — resolver interface, load stack, cycle detection, per-load module cache
- `src/typechecker.ts` — qualified value access, unqualified type/constructor import, cross-module collision errors
- `src/rules.ts`, `src/runner.ts`, `src/repl.ts` — resolver parameter threading (fs resolver for CLI)

**Dependencies:** Phase 1 (declarations are the main export payload).

**Done when:** `rill-state-lang.AC5.*` tests pass, including cycle-error path listing and transitive check of a broken helper.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Canonical bridge and createEngine
**Goal:** One bridge, type-directed, exported; generalized engine loop.

**Components:**
- New `src/bridge.ts` — `jsToRill`/`rillToJs`, discriminated-union tag convention, Option flattening, type-directed number conversion against header types
- New `src/engine.ts` — `createEngine` per the contract in Architecture
- `src/lib.ts` — export both; `src/CLAUDE.md` contract updated

**Dependencies:** Phases 1, 4 (declared Effect types; resolver).

**Done when:** `rill-state-lang.AC6.*` tests pass.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Consumer migrations
**Goal:** Both consumers on the new language; behavior pinned.

**Components:**
- Characterization tests in each consumer pinning current observable behavior (state + effects over scripted event sequences), written **before** migration; sentinel→Option translation table explicit in the HMB tests
- HMBWorkout: `src/engine/rules/{types,helpers,transition}.lv`; `src/engine/{index,loadRules,bridge}.ts` reduced to `createEngine` usage; `idx` pre-injection and enrichment deleted
- rill-job-tracker: `rules/*.lv` migrated (`transitions.lv` → declared `Stage`); `src/rill/bridge.ts` replaced by rill-lang import; boot gate re-verified
- rill-lang `npm run build` before each consumer verification (consumers run local `dist/`)

**Dependencies:** Phases 1–5.

**Done when:** `rill-state-lang.AC7.*` tests pass; characterization suites green post-migration; both boot gates verified to hard-fail on a deliberately broken rule.
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Documentation
**Goal:** Language docs and portfolio artifacts current.

**Components:**
- rill-lang `README.md` (new syntax, removed structural tags, migration notes), `examples/*.lv` rewritten, `src/examples.test.ts` re-pinned
- Vault: state-language chapter added to [[Deep Dive in Rill Language and the Rill Job Tracker]]; collab note updated; `docs/interview_questions.md` Q-bank extended (local-only file)

**Dependencies:** Phases 1–6.

**Done when:** `rill-state-lang.AC8.*` verified; examples characterization tests green.
<!-- END_PHASE_7 -->

## Additional Considerations

**Error-message quality is a design goal:** exhaustiveness errors list missing constructors by name; unknown constructors get did-you-mean suggestions; import cycle errors print the full path chain; bridge boundary errors name the offending field. All source-located.

**Implementation process:** Phases 1–2 are design-sensitive and should be implemented in dialogue style, not fleet-dispatched; Phases 3–7 are fleet-able (one draft PR per phase, worktree isolation) per the established review+fix workflow. No PR merges without explicit approval.

**dist/ gotcha:** consumers execute rill-lang's gitignored local `dist/`; every rill-lang merge requires `npm run build` before consumer verification or consumers silently run the old interpreter.

**Out of scope (explicit):** nested record-update sugar; Array type; optional record fields; module privacy; guard expressions containing `?`; nested `Option(Option(a))` across the bridge; runtime performance work.
