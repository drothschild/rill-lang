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

### Pattern Matching
```
let area = fn(shape) -> match shape {
  Circle(r) -> r * r * 3,
  Rect(w, h) -> w * h
}
in area(Rect(3, 4))   -- => 12
```

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
| 7 | `<` `>` `<=` `>=` | Numeric comparison |
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

Current caveats:

- `&&` and `||` do **not** short-circuit — both operands are always evaluated.
- `==`/`!=` evaluate only on `Int`, `Float`, `String`, and `Bool`. Comparing lists, records, tuples, tags, or `()` type-checks but throws at runtime.
- The type checker only requires both operands of an arithmetic or comparison operator to have the same type, so e.g. `"a" + "b"` type-checks but fails at runtime — use `++` to join strings.
- Integer `/` truncates toward zero; `/` and `%` by zero produce `Infinity`/`NaN` rather than an error.

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

- No algebraic data type declarations (tags are structural)
- `if` is a reserved keyword but there is no if-expression — use `match`
- The CLI runner (`runSource`) type-checks against an empty environment and skips type errors without source locations, so it is more permissive than the embedding API (`infer` with `createPreludeTypeEnv`) — a program that runs at the CLI can still fail an embedder's load-time type check
- No module system
- No string interpolation
- Single-file programs only
