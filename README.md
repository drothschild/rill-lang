# Rill

A statically-typed scripting language with [Hindley-Milner](https://en.wikipedia.org/wiki/Hindley%E2%80%93Milner_type_system) type inference, pipeline operators, and first-class error handling. Built as a [tree-walking interpreter](https://en.wikipedia.org/wiki/Interpreter_(computing)#Abstract_syntax_tree_interpreters) in TypeScript.

## Quick Example

```
-- Pipeline with error handling
let parse = fn(s) -> match s {
  "42" -> Ok(42),
  _ -> Err("bad input")
}
in "42" |> parse? |> fn n -> n * 2 |> catch e -> 0
-- => 84
```

## Usage

```bash
# Start the REPL
npx tsx src/index.ts

# Run a file
npx tsx src/index.ts run example.lv
```

### REPL Commands

- `:type <name>` — show the type of a binding
- `:env` — show all bindings
- `:quit` — exit

## Language Features

### Primitives
```
42          -- Int
3.14        -- Float
"hello"     -- String
true        -- Bool
()          -- Unit
```

### Let Bindings
```
let x = 5 in x + 1
let rec fib = fn(n) -> match n <= 1 { true -> n, false -> fib(n-1) + fib(n-2) } in fib(10)
```

`in` is optional: without it, the rest of the expression is the body, so sequential
bindings read top-to-bottom. `_` is accepted as a binder (in `let`, `fn` params, and
`catch`) for values you don't need to name.

```
let x = 5
let y = 10
x + y   -- => 15
```

Before/after with a real rule (dashboard.lv), using record field punning for the result:

```
-- Before
let total = length(jobs) in
let warm_count = length(filter(fn(j) -> j.application_type == "warm", jobs)) in
let cold_count = length(filter(fn(j) -> j.application_type == "cold", jobs)) in
{
  total: total,
  warm_count: warm_count,
  cold_count: cold_count
}

-- After
let total = length(jobs)
let warm_count = length(filter(fn(j) -> j.application_type == "warm", jobs))
let cold_count = length(filter(fn(j) -> j.application_type == "cold", jobs))
{ total, warm_count, cold_count }
```

### Functions (auto-curried)
```
let add = fn(a, b) -> a + b
in let add5 = add(5)
in add5(3)   -- => 8
```

### Pipe Operator
```
[1, 2, 3, 4, 5]
|> filter(fn(x) -> x > 2)
|> map(fn(x) -> x * 10)
|> fold(0, fn(acc, x) -> acc + x)
-- => 120
```

`fn` bodies stop before `|>`, so a lambda written inline in a pipeline is a single stage and the pipe continues at the outer level:

```
10 |> fn n -> n + 1 |> fn n -> n * 2
-- => 22, parsed as 10 |> (fn n -> n + 1) |> (fn n -> n * 2)
```

The flip side: `fn x -> x |> inc` parses as `(fn x -> x) |> inc`, **not** `fn x -> (x |> inc)` — piping the closure itself, which is usually a type error. To use a pipe inside a function body, parenthesize the body:

```
let inc = fn n -> n + 1 in
let f = fn x -> (x |> inc) in
f(10)   -- => 11
```

### Error Handling
```
-- ? unwraps Ok, short-circuits on Err
-- catch recovers from errors
head([1, 2, 3])? |> fn n -> n + 10 |> catch e -> 0
-- => 11
```

### Validation with require
`require(cond, msg)` returns `Ok(())` or `Err(msg)`, so chaining `require(...)?`
gives first-error-wins validation: the first failing check's `Err` becomes the
program's result, and each check sits on one line next to its message.

```
let job = { company_name: "Acme", role: "", salary_min: 50, salary_max: 40 } in
let a = require(str_len(job.company_name) > 0, "Company name is required")? in
let b = require(str_len(job.role) > 0, "Role is required")? in
let c = require(job.salary_min == 0 || job.salary_max == 0 || job.salary_min <= job.salary_max,
                "Minimum salary cannot exceed maximum salary")? in
Ok("valid")
-- => Err("Role is required")
```

This replaces the match-over-a-tuple-of-bools pattern, where each check is
separated from its message and adding a check means widening every arm:

```
match (has_company, has_role, salary_valid) {
  (false, _, _) -> Err("Company name is required"),
  (_, false, _) -> Err("Role is required"),
  (_, _, false) -> Err("Minimum salary cannot exceed maximum salary"),
  _ -> Ok("valid")
}
```

### Algebraic Data Types (ADTs)

Rill supports declared algebraic data types with unions, enabling exhaustive pattern matching and type-safe state machines.

**Type declarations** define named unions with constructors:

```
type Phase = Idle | Working | Resting

type Event =
  | Start({ sessionId: String })
  | Log({ reps: Int, weight: Float })
  | Pause
```

Constructors can carry payloads (data enclosed in `{}`); payloads are structural records with named fields. Constructor names are globally unique in scope (the Elm rule), so the typechecker can infer which type a constructor belongs to without annotation.

**Type parameters** (generics) are supported:

```
type Option(a) = Some(a) | None

type Result(a) = Ok(a) | Err(String)
```

Type variables like `a` are introduced in the type declaration and instantiated at use sites. The prelude defines `Option` and `Result` this way, so you can use `Option(Int)` or `Result({ status: Bool })`.

### Alias Declarations

An `alias` declaration names a record type for reuse in rule headers and other contexts:

```
alias SessionState = { phase: Phase, setCount: Int, isActive: Bool }

rule process(state: SessionState) -> SessionState
  { state | phase: Resting }
```

Aliases expand structurally — the typechecker doesn't distinguish between an aliased name and its expansion — so they compose freely with open records (`..`):

```
alias Config = { level: Int, name: String }

let add_extra = fn(cfg) -> { cfg | extra: true }  -- works if caller's cfg has extra
```

### Pattern Matching and Exhaustiveness

A `match` expression is exhaustive when it covers every constructor of its subject's declared type:

```
type Shape = Circle({ r: Int }) | Rect({ w: Int, h: Int })

let area = fn(shape) -> match shape {
  Circle(c) -> c.r * c.r * 3,
  Rect(r) -> r.w * r.h
}
in area(Rect({ w: 3, h: 4 }))   -- => 12
```

If a match is not exhaustive, the program fails at load time (the boot gate):

```
type Phase = Idle | Working | Resting | Paused

let describe = fn(p) -> match p {
  Idle -> "ready",
  Working -> "active"
  -- Error: This match does not cover all possible values of Phase.
  -- Missing patterns:
  --   - Resting
  --   - Paused
}
```

On non-union subjects (like `Bool` or a plain record), a match must have a catch-all arm (`_`):

```
match some_bool {
  true -> "yes",
  false -> "no"
}

match x {
  0 -> "zero",
  _ -> "other"
}
```

### Match Guards

A guard is a boolean condition attached to a pattern arm with `if`. Guards are evaluated with pattern bindings in scope and fall through to the next arm if they are false:

```
type Event = SetLog({ reps: Int, rpe: Option(Float) }) | Rest

match event {
  SetLog(log) if log.reps > 0 -> "logged a set",
  SetLog(_) -> "invalid set",
  Rest -> "pausing"
}
```

**Important:** Guards do not count toward exhaustiveness. An arm that is only guarded (no unguarded arm for its constructor) leaves a gap:

```
type Phase = Idle | Working | Done

let check = fn(p) -> match p {
  Idle if false -> 1,
  Working -> 2,
  Done -> 3
  -- Still incomplete: Idle has only a guarded arm, so if the guard fails,
  -- there is no fallback. The typechecker rejects this match.
}
```

To accept all values of a constructor, you must include an unguarded arm or make the guard exhaustive (e.g. use a boolean field that always has one branch true).

### Structural Tag Removal and Migration

**Prior to this version:** Rill allowed bare constructors like `Resting` or `Next` without declaring their types. These were inferred as "structural tags" — ad hoc unions owned by the context. This syntax is no longer supported.

**New requirement:** Every constructor must belong to a declared `type`. Unknown constructors are load-time errors with suggestions:

```
-- Old code (no longer works):
let state = Resting in state

-- Error: Unknown constructor: Resting
-- Did you mean one of: ...
```

**Migration path:** Declare the type first:

```
type Phase = Idle | Resting | Working

let state = Restng in state  -- typo in constructor name
-- Error at line 3, col 13:
--   Unknown constructor: Restng (did you mean Resting?)
```

This change improves type safety (all state is explicit) and enables exhaustiveness checking, the core safety feature of a state machine language.

### Record Update

The record update syntax creates a shallow copy of a record with one or more fields changed:

```
let state = { phase: Working, count: 5 }
let updated = { state | phase: Idle, count: 0 }
-- updated is { phase: Idle, count: 0 }, state is unchanged
```

Rules:
- The base record must already contain every field being updated; adding new fields is an error.
- The type of each updated field cannot change (PureScript restriction).
- Open records and row polymorphism work as expected — a function expecting `{ phase, .. }` can be called with a record that has extra fields, and updates preserve those extras.

```
let with_extra = fn(s) -> { s | phase: Resting }

with_extra({ phase: Working, extra_field: "ok" })
-- => { phase: Resting, extra_field: "ok" }
```

### List Indexing and Option Absence

**List indexing** via the `at` builtin replaces sentinel values and host-side pre-indexing:

```
at(0, [10, 20, 30])  -- => Ok(10)
at(2, [10, 20, 30])  -- => Ok(30)
at(5, [10, 20, 30])  -- => Err("index 5 out of bounds (list has 3 elements)")
at(-1, [10, 20, 30]) -- => Err("index -1 out of bounds (list has 3 elements)")

[10, 20, 30] |> at(1)? |> fn(v) -> v * 2  -- => 40
```

**Option type** replaces sentinel values like `rpe: -1.0` or `nextPhase: ""`:

```
alias Set = { reps: Int, weight: Float, rpe: Option(Float) }

let s = { reps: 10, weight: 100.0, rpe: None }
let s2 = { s | rpe: Some(7.5) }

match s2.rpe {
  Some(rpe_val) -> "RPE: " ++ to_string(rpe_val),
  None -> "no RPE recorded"
}
```

**Option helpers:**

- `with_default : a -> Option(a) -> a` — unwrap or return a default:
  ```
  with_default(0.0, Some(7.5))  -- => 7.5
  with_default(1.5, None)       -- => 1.5
  ```

- `map_option : (a -> b) -> Option(a) -> Option(b)` — transform inside an Option:
  ```
  map_option(fn(x) -> x * 2, Some(5))  -- => Some(10)
  map_option(fn(x) -> x * 2, None)     -- => None
  ```

### Modules

For larger rule files, code can be split across modules using `import`:

```
import "types" as t
import "helpers" as h

-- Call qualified value
let duration = h.estimate_duration(session)

-- Use unqualified types/constructors (imported from module or declared here)
match event {
  t.StartSession(p) -> ...
  -- Actually: just StartSession(p) if StartSession was imported
}
```

**Import semantics:**
- A module is a `.lv` file containing `type`, `alias`, and `let` declarations.
- **Values** from imported modules are accessed with dot notation (`h.function_name`).
- **Types and constructors** are imported unqualified — they enter scope as if declared locally (constructor names are globally unique, so ambiguity is impossible).
- The resolver is pluggable; the CLI uses filesystem resolution relative to the importing file.

**Cycle detection:** An import cycle is a load-time error listing the full cycle path. Diamond imports (two modules importing a shared third) are fine and do not duplicate-check the shared module.

**Type errors in helpers:** If an imported helper has a type error, the error is located in the helper's source; the importing rule fails at the boot gate.

### Bridge and Engine

When embedding Rill in TypeScript, values cross the boundary via `jsToRill` and `rillToJs`, both exported from the library:

**JavaScript to Rill (`jsToRill`):**
- Type-directed conversion against the rule's declared parameter types.
- Declared `Int`: `42` → Int; `42.5` → error naming the field.
- Declared `Float`: `42` → `42.0` (coerces integers); `42.5` → Float.
- Declared `Option(T)`: `undefined` → `None`; present value → `Some(converted T)`.
- Declared union (ADT): expects `{ tag: string, value?: unknown }`; validates tag and recursively converts payload.
- Declared record: field-by-field conversion; missing non-Option field → error; extra keys ignored.
- Lists: element-wise conversion.

**Rill to JavaScript (`rillToJs`):**
- Tag (no payload): `{ tag: "Resting" }`.
- Tag with payload: `{ tag: "LogSet", value: { reps: 10, weight: 100.0 } }`.
- `Option`: `Some(x)` → unwrapped `x`; `None` → `undefined`.
- Records, lists, strings, numbers as-is.

**Engine dispatch loop** (`createEngine`):**

```typescript
const engine = createEngine({
  resolve: (path) => readFileSync(path, "utf-8"),  // module resolver
  entry: "transition.lv",                          // entry rule path
  initialState: { phase: "Idle", count: 0 },
  executors: {
    "ScheduleRest": ({ deadlineMs }) => { ... },
    "LogSet": ({ reps, weight }) => { ... },
  }
});

const newState = engine.dispatch({ tag: "SetLog", value: { reps: 10, weight: 100.0 } });
```

The engine expects an entry rule with signature:
```
rule transition(state: StateType, event: EventType) -> Result({ state: StateType, effects: List(EffectType) })
```

On `Ok`, the new state is extracted, effects are applied in order, and the engine's internal state is swapped. On `Err`, a `TransitionError` is thrown and state is not swapped.

### If/Then/Else
`if` is an expression, so `else` is always required — every `if` produces a value. Both branches must have the same type, and chained `else if` nests naturally:
```
let x = 5 in
if x > 10 then "big"
else if x > 3 then "mid"
else "small"
-- => "mid"
```

Rules that used to encode conditions as a match on a tuple of booleans read better with `if`. Before:
```
-- Injected: job (Record), is_active (Bool)
{
  follow_up_due: match (is_active, job.follow_up_date_passed) {
    (true, true) -> true,
    _ -> false
  }
}
```
After:
```
{
  follow_up_due: if is_active then job.follow_up_date_passed else false
}
```

Branches parse greedily, so a trailing `|>` binds inside the `else` branch (just like `let ... in` bodies). Parenthesize the `if` to pipe its result:
```
if c then a else b |> f     -- pipes b into f, then picks a or (b |> f)
(if c then a else b) |> f   -- pipes the chosen value into f
```

### Data Structures
```
[1, 2, 3]                    -- Lists
(1, "hello")                 -- Tuples
{ name: "Alice", age: 30 }   -- Records
{ name, age }                -- Record punning: { name: name, age: age }
Ok(42)                        -- Tagged values
```

### Operators

From highest to lowest precedence (matching `infixBp` in `src/parser.ts`); all binary operators are left-associative:

| Precedence | Operators | Description |
|------------|-----------|-------------|
| 1 (highest) | `.` | Record field access |
| 2 | `?` (postfix) | Unwrap `Ok`, short-circuit on `Err` |
| 3 | `!` `-` (prefix) | Boolean not, numeric negation |
| 4 | `*` `/` `%` | Multiply, divide (truncating on `Int`), modulo |
| 5 | `+` `-` | Add, subtract |
| 6 | `++` | String concatenation |
| 7 | `<` `>` `<=` `>=` | Comparison (`Int`/`Float`, or lexicographic on `String`) |
| 8 | `==` `!=` | Equality |
| 9 | `&&` | Boolean and |
| 10 | `\|\|` | Boolean or |
| 11 (lowest) | `\|>` | Pipeline |

```
1 + 2 * 3               -- => 7
7 % 3                   -- => 1
"foo" ++ "bar" ++ "!"   -- => "foobar!"
1 < 2 && 2 < 3          -- => true
!true || 1 == 1         -- => true
-5 + 3                  -- => -2
```

Semantics notes:

- `&&` and `||` short-circuit: the right operand is only evaluated when needed.
- `==`/`!=` are deep structural equality over any non-function values (lists, records, tuples, tags, `()`); `Int` and `Float` compare numerically, so `5 == 5.0` is `true`. Comparing functions is an error.
- Arithmetic requires numeric operands (`"a" + "b"` is a type error — use `++` to join strings); comparisons accept `Int`, `Float`, or `String`.
- Integer `/` truncates toward zero; `/` and `%` by zero raise a positioned runtime error.

## Rule Headers

A rule file can declare its own input contract with a `rule` header, so embedders
can type-check every rule at load time without maintaining an external signature
registry:

```
rule alerts(
  job: { current_stage: String, follow_up_date_passed: Bool, days_since_update: Int, .. },
  alert_threshold: Int
) -> { is_active: Bool, follow_up_due: Bool, no_response: Bool }

let is_active = !one_of(job.current_stage, ["Rejected", "Offer"])
{
  is_active,
  follow_up_due: is_active && job.follow_up_date_passed,
  no_response: is_active && job.days_since_update > alert_threshold
}
```

Type annotations cover `Int`, `Float`, `String`, `Bool`, `Unit`, `List(T)`,
`Result(T)`, tuples `(A, B)`, and record types. A trailing `..` in a record type
marks an open row (the injected record may carry extra fields); without it the
record is closed and reading undeclared fields is a type error. The return type
(`-> Type`) is optional; when present, the body's inferred type must unify with it.

Embedders check a rule with `checkRuleSource(source)`, which returns
`{ ok, errors, header }` and never throws. The header's params are the exact
environment the host must inject at evaluation time; evaluate a headed file by
parsing with `parseProgram` and evaluating `program.body`. Headerless files are
unaffected — `parse` and `evaluate` work exactly as before.

## Architecture

Five-phase pipeline:

```
Source → Lexer → Parser → Type Checker → Evaluator → Result
         tokens   AST      types          values
```

- **Lexer** (`src/lexer.ts`): Character-by-character scanning, produces tokens with source spans
- **Parser** (`src/parser.ts`): [Pratt parser](https://en.wikipedia.org/wiki/Operator-precedence_parser#Pratt_parsing) with precedence climbing for all expressions
- **Type Checker** (`src/typechecker.ts`): [Algorithm W](https://en.wikipedia.org/wiki/Hindley%E2%80%93Milner_type_system#Algorithm_W) with let-polymorphism and unification
- **Evaluator** (`src/evaluator.ts`): Tree-walking interpreter with closures and exception-based `?` operator
- **Prelude** (`src/prelude.ts`): Built-in functions (map, filter, fold, head, tail, etc.)

## Prelude Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `map` | `(a -> b, List(a)) -> List(b)` | Map over a list |
| `filter` | `(a -> Bool, List(a)) -> List(a)` | Filter a list |
| `fold` | `(b, (b, a) -> b, List(a)) -> b` | Fold/reduce a list |
| `length` | `List(a) -> Int` | List length |
| `str_len` | `String -> Int` | String length |
| `head` | `List(a) -> Result(a)` | First element |
| `tail` | `List(a) -> Result(List(a))` | Rest of list |
| `to_string` | `a -> String` | Convert to string |
| `print` | `a -> Unit` | Print to stdout |
| `concat` | `(String, String) -> String` | Concatenate strings |
| `each` | `(a -> b, List(a)) -> Unit` | Iterate with side effects |
| `count` | `(a -> Bool, List(a)) -> Int` | Count elements matching a predicate |
| `contains` | `(a, List(a)) -> Bool` | Membership test (structural equality) |
| `one_of` | `(a, List(a)) -> Bool` | Alias of `contains`; reads as `one_of(value, candidates)` |
| `lookup` | `(k, List((k, v))) -> Result(v)` | Assoc-list lookup: `Ok(v)` for the first matching key, else `Err("not found: <key>")` |
| `require` | `(Bool, String) -> Result(Unit)` | `Ok(())` if the condition holds, else `Err(msg)` |

`contains` and `one_of` are the same function: needle first, list last (so
`list |> contains(x)` pipes naturally). Use `one_of` when the list is a fixed
set of candidates: `one_of(job.current_stage, ["Rejected", "Offer"])`.

Note: at runtime `length` also accepts a `String`, but its type signature is `List(a) -> Int`, so `length` on a string is rejected by the type checker — use `str_len` for string length.

## Known Limitations

- The CLI runner (`runSource`) type-checks against an empty environment and skips type errors without source locations, so it is more permissive than the embedding API (`infer` with `createPreludeTypeEnv`) — a program that runs at the CLI can still fail an embedder's load-time type check
- No string interpolation
