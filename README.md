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
Ok(42)                        -- Tagged values
```

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
| `length` | `List(a) -> Int` | List or string length |
| `head` | `List(a) -> Result(a)` | First element |
| `tail` | `List(a) -> Result(List(a))` | Rest of list |
| `to_string` | `a -> String` | Convert to string |
| `print` | `a -> Unit` | Print to stdout |
| `concat` | `(String, String) -> String` | Concatenate strings |
| `each` | `(a -> b, List(a)) -> Unit` | Iterate with side effects |

## Known Limitations

- No algebraic data type declarations (tags are structural)
- Type checker doesn't have prelude type signatures (type checking is best-effort for programs using built-ins)
- No module system
- No string interpolation
- Single-file programs only
