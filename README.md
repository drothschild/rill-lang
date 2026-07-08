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

### Pattern Matching
```
let area = fn(shape) -> match shape {
  Circle(r) -> r * r * 3,
  Rect(w, h) -> w * h
}
in area(Rect(3, 4))   -- => 12
```

### Data Structures
```
[1, 2, 3]                    -- Lists
(1, "hello")                 -- Tuples
{ name: "Alice", age: 30 }   -- Records
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

Note: at runtime `length` also accepts a `String`, but its type signature is `List(a) -> Int`, so `length` on a string is rejected by the type checker — use `str_len` for string length.

## Known Limitations

- No algebraic data type declarations (tags are structural)
- `if` is a reserved keyword but there is no if-expression — use `match`
- The CLI runner (`runSource`) type-checks against an empty environment and skips type errors without source locations, so it is more permissive than the embedding API (`infer` with `createPreludeTypeEnv`) — a program that runs at the CLI can still fail an embedder's load-time type check
- No module system
- No string interpolation
- Single-file programs only
