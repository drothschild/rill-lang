# Rill State Language — Test Analysis & Human Test Plan

**Test requirements:** `/Users/davidrothschild/Projects/rill-lang/.worktrees/rill-state-lang/docs/implementation-plans/2026-07-21-rill-state-lang/test-requirements.md`
**Diff range:** `d83b39a` → `622193f`
**Generated:** 2026-07-21

## Coverage Validation

**Automated criteria:** 24 (the automated core of all 27 sub-criteria; AC8.2 is human-only) | **Covered:** 24 | **Missing:** 0

Local suite: **696 tests / 22 files passing** (`npx vitest run`). External: HMBWorkout 251 Jest tests and rill-job-tracker 213 Vitest tests, both on branch `davidrothschild/rill-state-lang-migration`.

### Covered

| Criterion | Test file(s) | Verifies |
|-----------|-------------|----------|
| AC1.1 | `src/parser.test.ts`, `src/typechecker.test.ts`, `src/rules.test.ts` | Payload-less + payload `type` parse; `Circle(2.0)`→`Shape`; payload var bound with instantiated type in arm (`LogSet(p) -> p.reps`→Int) |
| AC1.2 | `src/decls.test.ts`, `src/rules.test.ts` | Alias expands to TRecord; alias in header; alias↔inline-structural forms unify |
| AC1.3 | `src/typechecker.test.ts`, `src/decls.test.ts` | Unknown ctor `Circl(2.0)` errors with "Unknown constructor"+`Circl` did-you-mean; source-located |
| AC1.4 | `src/typechecker.test.ts`, `tests/integration.test.ts`, `src/rules.test.ts` | Ok/Err/Some/None as prelude ctors; `?`/`catch` end-to-end; `prettyType` renders `Result(Int)` (single arg) |
| AC1.5 | `src/typechecker.test.ts`, `src/rules.test.ts` | Non-exhaustive match fails gate, names each missing ctor in declaration order; **joint-coverage `W(Some(x))+W(None)` pinned as REJECTED false positive** (missing `W(_)`) |
| AC1.6 | `src/rules.test.ts`, `src/typechecker.test.ts` | Wrong-arm payload access errors; `PauseSession(p)` on payload-less ctor errors (arity) |
| AC1.7 | `src/parser.test.ts`, `src/evaluator.test.ts`, `src/typechecker.test.ts` | Guard parses; false falls through; guard sees pattern bindings; non-Bool guard rejected |
| AC1.8 | `src/parser.test.ts`, `src/typechecker.test.ts`, `src/rules.test.ts` | `?`-in-guard is a parse error; guarded arms excluded from coverage; deleting unguarded fallback fails |
| AC2.1 | `src/parser.test.ts`, `src/typechecker.test.ts`, `src/unify.test.ts`, `src/evaluator.test.ts` | `{ s \| a: 2 }` parses/types; row polymorphism preserved; original record unchanged (copy semantics) |
| AC2.2 | `src/typechecker.test.ts` | **Both pinned:** closed base + absent field errors; open base defers, errors at first closed call site; type-change unconditionally rejected |
| AC3.1 | `src/prelude.test.ts`, `tests/integration.test.ts` | `at(2,xs)`→`Ok`; composes with `?` and `\|>` |
| AC3.2 | `src/prelude.test.ts` | Exact `Err("index 5 out of bounds (list has 3 elements)")`; negative index variant |
| AC4.1 | `src/typechecker.test.ts`, `src/rules.test.ts` | `Option(a)` in headers/aliases; Some/None match; missing-None fails exhaustiveness (Phase 2 half) |
| AC4.2 | `src/prelude.test.ts`, `src/typechecker.test.ts` | `with_default`/`map_option` behavior + signatures |
| AC4.3 | `src/prelude-consistency.test.ts` | Bidirectional set-equality of runtime vs type-env builtins; arrow-count ≥ arity |
| AC5.1 | `src/parser.test.ts`, `src/modules.test.ts`, `src/rules.test.ts`, `src/runner.test.ts` | Import parses; `h.func(...)` resolves+types+evals; imported types usable unqualified; real `.lv` fixtures via `createFsResolver` |
| AC5.2 | `src/modules.test.ts`, `src/rules.test.ts` | Cycle message `a -> b -> a`; helper type error located in helper source (single "Error at") |
| AC5.3 | `src/modules.test.ts` | Diamond loads shared once (`size===4`, topo order); evaluated once (referential identity) |
| AC5.4 | `src/modules.test.ts` | Cross-module + prelude collision detected, names colliding identifier. *Impl (`modules.ts:133/143/155`) also names both module paths — see note.* |
| AC6.1 | `src/bridge.test.ts`, `tests/lib-smoke.test.ts` | `{tag,value?}` round-trip; None↔undefined/absent; Some(x)↔x; verified through **built `dist/lib.js`** |
| AC6.2 | `src/bridge.test.ts`, `src/engine.test.ts` | `42`→Float coerces; `42.5`→Int rejected naming field; nested field paths (`state...entries[0].reps`, `[1]`) |
| AC6.3 | `src/engine.test.ts` | Construction gate + `TransitionError`; Ok state-swap-first then executors in effect order; Err preserves state; **async fire-and-forget → `onExecutorError`**; no-callback microtask rethrow via scoped `unhandledRejection` listener |
| AC7.1 | `HMBWorkout/src/engine/characterization.test.ts` | 27-test suite; `normalize()` encodes sentinel→Option table; `transition.lv` has no `-1.0`/`""`/`idx`/full-record re-spelling; host has no `buildCompositeTransition`/idx pre-injection |
| AC7.2 | `rill-job-tracker/tests/rill-rules.test.ts`, `rill-bridge.test.ts`, `typecheck.test.ts` | 4 rules produce unchanged outputs on re-encoded (`stageToTag`) fixtures; `transitions.lv` declares `type Stage`; validation/alerts/dashboard type-check unchanged |
| AC7.3 (automated core) | `HMBWorkout/src/engine/loadRules.test.ts`, `rill-job-tracker/tests/typecheck.test.ts` + `fixtures/nonexhaustive.lv` | Doctored/fixture non-exhaustive source → checker reports `/missing/` + missing ctor name (`FinishSession` / `Paused`) |
| AC8.1 (automated half) | `src/examples.test.ts` | All 4 examples (calc, markdown, state_machine, todo) run and match re-pinned `EXPECTED` output |

### Notes (assertion-strength, not gaps)
- **AC5.4:** the "names both module paths" behavior is implemented (`modules.ts` emits `declared in both "x" and "y"`) but the test asserts only the colliding identifier. Load-time collision detection is genuinely verified; strengthening the assertion to also match both paths would fully close the criterion's wording. Non-blocking.
- **AC5.2:** helper error location verified by module path + a single "Error at" marker; exact line number not numerically asserted.
- **AC5.3:** "evaluated once" verified by referential object identity inside a conditional guard rather than a call-count spy.

**Result: PASS**

All automatable criteria are covered by tests that verify the described behavior. Proceeding to the human test plan.

---

## Human Test Plan

### Prerequisites
- Node/npm installed; three repos checked out:
  - rill-lang worktree: `/Users/davidrothschild/Projects/rill-lang/.worktrees/rill-state-lang`
  - HMBWorkout: `/Users/davidrothschild/Projects/HMBWorkout` (branch `davidrothschild/rill-state-lang-migration`)
  - rill-job-tracker: `/Users/davidrothschild/Projects/rill-job-tracker` (branch `davidrothschild/rill-state-lang-migration`)
- In the rill-lang worktree: `npx vitest run` passes (expect **696 passed**), then `npm run build` (regenerates `dist/`, which embedders import).
- **GATING HANDOFF must be resolved before any AC7 step** — see the dedicated section below.

### Phase 1–4: Language surface (rill-lang, via CLI)
Run each `.lv` with `npm run rill -- run <file>` from the worktree root.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `npm run rill -- run examples/calc.lv` | Prints the calc block ending `10 / 0 = Error: division by zero`, `unknown = Error: unsupported expression (type-checked at load time)`, `=== Done! ===`, `()` |
| 2 | Run all four examples (`calc`, `markdown`, `state_machine`, `todo`) | Each prints its full expected block and exits 0; `state_machine.lv` ends `Final state: Locked` |
| 3 | Create `/tmp/adt.lv`: `type Shape = Circle(Float) \| Square(Float)` + a `match` covering only `Circle`, terminal expr `0`; run it | Load-time error naming the missing `Square` constructor; exit 1 (nothing evaluated) |
| 4 | Edit `/tmp/adt.lv` to `Circl(2.0)` (typo) in an expression; run it | Error "Unknown constructor" with did-you-mean suggesting `Circle`, showing source line/col |
| 5 | Create `/tmp/upd.lv`: `let s = { a: 1, b: 2 }` then `{ s \| c: 3 }` terminal; run it | Load-time error naming the absent field `c` (closed-record rule) |
| 6 | Change step 5 to `{ s \| a: 99 }`; run it | Succeeds; prints a record with `a` changed, `b` preserved |
| 7 | Create `/tmp/idx.lv`: `at(5, [10, 20, 30])`; run it | Prints `Err("index 5 out of bounds (list has 3 elements)")` |
| 8 | Create a two-file module set under `/tmp/mods/` (`entry.lv` imports `helpers.lv`, calls `h.func(...)`, uses an imported type unqualified); run `entry.lv` | Resolves via filesystem, prints the helper result; imported type usable without prefix |
| 9 | Make two imported modules both declare `type Phase`; run the entry | Load-time collision error naming `Phase` **and both module paths** (confirm both paths appear — this is the AC5.4 assertion the suite under-checks) |
| 10 | Make module `a` import `b` and `b` import `a`; run | Error `Import cycle: a -> b -> a` |

### Phase 5: Bridge & engine (rill-lang)
| Step | Action | Expected |
|------|--------|----------|
| 11 | In a Node REPL against `dist/lib.js`: `rillToJs` a `None` value, then a `Some(5)` | `None`→`undefined`; `Some(5)`→`5` |
| 12 | `jsToRill(42, Float, …)` then `jsToRill(42.5, Int, {field:"reps"} …)` | `42`→`42.0`; `42.5` throws `BridgeError` whose message contains `reps` |
| 13 | Build a `createEngine` with a good entry rule + an executor; `dispatch` an event that yields `Ok` | Returns new state; `getState()` reflects swap; executor invoked once with the effect payload |
| 14 | `dispatch` an event that yields `Err` | Throws `TransitionError`; `getState()` unchanged; no executor ran |

### GATING HANDOFF (Phase 6 precondition — do first, gates all AC7)
Purpose: both consumers resolve `../rill-lang` to the MAIN checkout, not this worktree. A stale `dist/`/tarball silently runs the OLD interpreter — the highest-risk pitfall in the plan.

Steps:
1. Decide per consumer: (a) merge/checkout the rill-lang branch in the main checkout, OR (b) temporarily repoint each consumer's `package.json` at the worktree (revert before the consumer PRs finalize). Do **not** silently repoint.
2. Run `npm run build` against the chosen tree. For HMBWorkout (tarball dependency): also `npm pack` + reinstall so the new tarball is what's installed.
3. Verify each consumer imports the migrated interpreter (e.g. spot-check that `createEngine`/new syntax exists in the installed package) before trusting any AC7 test result.

### Human Verification Required

| Criterion | Why manual | Steps |
|-----------|-----------|-------|
| **AC7.1** executor async-ordering read-through (recorded decision #4) | `createEngine` no longer awaits executors; behavior change must be signed off, not discovered later | Read each effect handler in `HMBWorkout/src/engine/index.ts`. Decide whether any depends on a prior executor's async completion. If yes, wrap in a sequential promise queue; if no, record that finding in the commit message. This is an explicit operator sign-off. |
| **AC7.3** boot-gate observation (tracker) | Automated tests exercise the *check function*; only a real boot proves the *process-level* gate | In rill-job-tracker, temporarily delete one arm from a real rule (e.g. `transitions.lv`), boot the server, observe `process.exit(1)`, restore the arm. Paste observed output into the PR. |
| **AC7.3** boot-gate observation (HMB) | Same — process-level gate not reachable by the check-function tests | In HMBWorkout, temporarily drop an arm from the real `transition.lv`, run the app, observe the `RuleErrorScreen` renders, restore. Record in the PR. |
| **AC8.1** README completeness | Prose-completeness judgment | Read `README.md`: confirm it documents each new feature — declared `type`/`alias`, exhaustive `match`, guards, record update, `at` + Option helpers (`with_default`/`map_option`), modules/import, bridge + engine — and the structural-tag-removal migration note. Run the README code snippets per the repo's readme-accuracy convention. |
| **AC8.2** portfolio docs | Lives outside the repo (Obsidian vault) + a gitignored local file; subjective content + dating check | Via obsidian-cli, confirm the "Deep Dive in Rill Language and the Rill Job Tracker" note and the collaboration note each carry a **dated** state-language chapter written after implementation (disambiguate the collab note with the operator if the search is ambiguous). Confirm `git check-ignore docs/interview_questions.md` still reports it ignored — do NOT force-add it. |

### End-to-End: Author → run → break → observe (full-stack)
Purpose: validates the whole load-time gate + engine path a consumer actually depends on.
Steps:
1. In a consumer (post-handoff), start the app/server with all rules valid → boots cleanly, engine dispatches events, state transitions and effects fire as before migration.
2. Introduce a non-exhaustive match in a real rule → reboot → the load gate hard-fails (`process.exit(1)` in tracker / `RuleErrorScreen` in HMB) with a message naming the missing constructor.
3. Restore the rule → reboot → app returns to normal. Confirms the gate is a genuine boot-time guard, not just a unit-tested function.

### End-to-End: Characterization parity (HMBWorkout)
Purpose: confirms the migration preserved behavior modulo the sentinel→Option table.
Steps: after the handoff build, run the Jest suite including `src/engine/characterization.test.ts` (27 tests). All pass, meaning the same characterization suite is green pre- and post-migration; the `normalize()` sentinel→Option mapping is the documented "modulo" allowance.

### Traceability

| Acceptance criterion | Automated test | Manual step |
|----------------------|----------------|-------------|
| AC1.1–1.8 | parser/typechecker/decls/evaluator/rules tests | Steps 3, 4 |
| AC2.1–2.2 | parser/typechecker/unify/evaluator tests | Steps 5, 6 |
| AC3.1–3.2 | prelude/integration tests | Step 7 |
| AC4.1–4.3 | typechecker/prelude/prelude-consistency tests | Step 7 (Option), 3 (missing None) |
| AC5.1–5.4 | parser/modules/rules/runner tests | Steps 8, 9, 10 |
| AC6.1–6.3 | bridge/engine/lib-smoke tests | Steps 11–14 |
| AC7.1 | `characterization.test.ts` (Jest) | Handoff build; executor read-through; E2E parity |
| AC7.2 | `rill-rules`/`rill-bridge`/`typecheck` tests (Vitest) | Handoff build |
| AC7.3 | `loadRules.test.ts`, `typecheck.test.ts` + fixture | Both boot-gate observations; E2E break/observe |
| AC8.1 | `examples.test.ts` | README completeness review |
| AC8.2 | — (human-only) | Obsidian vault + gitignore check |
