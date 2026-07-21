import { describe, it, expect } from "vitest";
import { lex } from "./lexer";
import { parseProgram } from "./parser";
import { checkRuleSource } from "./rules";
import { prettyType } from "./types";

describe("rule headers", () => {
  describe("parsing", () => {
    it("parses a file without a header as a plain body", () => {
      const program = parseProgram(lex("1 + 2"));
      expect(program.header).toBeNull();
      expect(program.body).toMatchObject({ kind: "BinOp", op: "+" });
    });

    it("parses a header with primitive params", () => {
      const program = parseProgram(lex(`
        rule transitions(from_stage: String, to_stage: String) -> Result(String)
        Ok("allowed")
      `));
      expect(program.header).not.toBeNull();
      expect(program.header!.name).toBe("transitions");
      expect(program.header!.params.map(p => p.name)).toEqual(["from_stage", "to_stage"]);
      expect(prettyType(program.header!.params[0].type)).toBe("String");
      expect(prettyType(program.header!.returnType!)).toBe("Result(String)");
      expect(program.body).toMatchObject({ kind: "Tag", tag: "Ok" });
    });

    it("parses record param types with an open row marker", () => {
      const program = parseProgram(lex(`
        rule alerts(job: { current_stage: String, days_since_update: Int, .. }, alert_threshold: Int) -> { is_active: Bool }
        { is_active: true }
      `));
      const job = program.header!.params[0].type;
      expect(job.kind).toBe("TRecord");
      if (job.kind === "TRecord") {
        expect(job.rest).not.toBeNull();
        expect(prettyType(job.fields.get("current_stage")!)).toBe("String");
      }
      const ret = program.header!.returnType!;
      expect(ret.kind).toBe("TRecord");
      if (ret.kind === "TRecord") expect(ret.rest).toBeNull();
    });

    it("parses List, tuple, and nested types", () => {
      const program = parseProgram(lex(`
        rule dashboard(jobs: List({ current_stage: String, .. }), pairs: List((String, Int)))
        length(jobs)
      `));
      const jobs = program.header!.params[0].type;
      expect(jobs.kind).toBe("TList");
      const pairs = program.header!.params[1].type;
      expect(pairs.kind).toBe("TList");
      if (pairs.kind === "TList") expect(pairs.element.kind).toBe("TTuple");
      expect(program.header!.returnType).toBeNull();
    });

    it("parses unknown type names as TUnion references (validation deferred to type-check)", () => {
      const program = parseProgram(lex("rule r(x: Widget) -> Bool\ntrue"));
      expect(program.header).not.toBeNull();
      expect(program.header!.params[0].type).toMatchObject({
        kind: "TUnion",
        name: "Widget",
        args: [],
      });
    });

    it("rejects a header without parens", () => {
      expect(() => parseProgram(lex("rule r x"))).toThrow(/Expected LParen/);
    });

    it("allows trailing comma in params and record types", () => {
      const program = parseProgram(lex(`
        rule r(a: Int, b: { x: Bool, },) a
      `));
      expect(program.header!.params.length).toBe(2);
    });
  });

  describe("checkRuleSource", () => {
    it("accepts a rule whose body matches the declared types", () => {
      const result = checkRuleSource(`
        rule add(a: Int, b: Int) -> Int
        a + b
      `);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.header!.name).toBe("add");
    });

    it("rejects a body that misuses a declared param", () => {
      const result = checkRuleSource(`
        rule r(name: String) -> Int
        name + 1
      `);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects a body whose result contradicts the declared return type", () => {
      const result = checkRuleSource(`
        rule r(a: Int) -> String
        a + 1
      `);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toMatch(/return/i);
    });

    it("checks bodies against prelude types (str_len vs length)", () => {
      const bad = checkRuleSource(`
        rule r(job: { company_name: String, .. }) -> Bool
        length(job.company_name) > 0
      `);
      expect(bad.ok).toBe(false);
      const good = checkRuleSource(`
        rule r(job: { company_name: String, .. }) -> Bool
        str_len(job.company_name) > 0
      `);
      expect(good.ok).toBe(true);
    });

    it("open rows allow extra fields, closed rows reject unknown field reads", () => {
      const closed = checkRuleSource(`
        rule r(job: { a: Int }) -> Int
        job.b
      `);
      expect(closed.ok).toBe(false);
      const open = checkRuleSource(`
        rule r(job: { a: Int, .. }) -> Int
        job.b
      `);
      expect(open.ok).toBe(true);
    });

    it("requires a header", () => {
      const result = checkRuleSource("1 + 1");
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toMatch(/header/i);
      expect(result.header).toBeNull();
    });

    it("reports parse errors as errors, not throws", () => {
      const result = checkRuleSource("rule r(a: Int) ->");
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBe(1);
    });

    it("typechecks the real validation rule shape", () => {
      // With Task 8-11 TUnion support implemented, this now works
      const result = checkRuleSource(`
        rule validation(job: { company_name: String, role: String, salary_min: Int, salary_max: Int }) -> Result(String)
        let _ = require(str_len(job.company_name) > 0, "Company name is required")?
        Ok("valid")
      `);
      expect(result.ok).toBe(true);
    });

    it("accepts a rule file with declared type constructors", () => {
      const result = checkRuleSource(`
        type Stage = Applied | Rejected
        rule f(s: Stage) -> Bool
        match s { Applied -> true, Rejected -> false }
      `);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("accepts a rule file with an alias in the header", () => {
      const result = checkRuleSource(`
        alias Job = { company_name: String }
        rule f(job: Job) -> Bool
        str_len(job.company_name) > 0
      `);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("allows alias and inline-structural forms to unify", () => {
      const result = checkRuleSource(`
        alias Job = { company_name: String }
        rule f(job: Job) -> { company_name: String }
        job
      `);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("accepts Option type in headers", () => {
      const result = checkRuleSource(`
        rule f(x: Option(Float)) -> Float
        match x { Some(v) -> v, None -> 0.0 }
      `);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("rejects a header with an unknown type name", () => {
      const result = checkRuleSource(`
        rule f(x: Stge) -> Bool
        true
      `);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Stge");
    });

    it("provides did-you-mean suggestion for typo in type name", () => {
      const result = checkRuleSource(`
        type Stage = Applied | Rejected
        rule f(x: Stge) -> Bool
        true
      `);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain("Stage");
    });

    it("reports source-located errors for unknown header type names", () => {
      const result = checkRuleSource(`rule f(x: Bogus) -> Int
  x`);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Should include source location with line/col info
      expect(result.errors[0]).toMatch(/Error at.*line.*col|line.*col/i);
      expect(result.errors[0]).toContain("Bogus");
    });

    it("reports source-located errors for unknown return type names", () => {
      const result = checkRuleSource(`rule f(x: Int) -> UnknownType
  x`);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Should include source location with line/col info
      expect(result.errors[0]).toMatch(/Error at.*line.*col|line.*col/i);
      expect(result.errors[0]).toContain("UnknownType");
    });

    describe("Task 6: Exhaustiveness checking at load gate", () => {
      it("AC1.5: non-exhaustive match fails the load gate", () => {
        const result = checkRuleSource(`
          type Event = LogSet({ reps: Int }) | PauseSession | RestElapsed({ reps: Int })
          rule f(e: Event) -> Int
          match e {
            LogSet(p) -> p.reps
          }
        `);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toMatch(/missing|exhaustiv/i);
      });

      it("AC1.5: exhaustive match passes the load gate", () => {
        const result = checkRuleSource(`
          type Event = LogSet({ reps: Int }) | PauseSession
          rule f(e: Event) -> Int
          match e {
            LogSet(p) -> p.reps,
            PauseSession -> 0
          }
        `);
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it("AC1.6: payload access from wrong constructor arm fails", () => {
        const result = checkRuleSource(`
          type Event = LogSet({ reps: Int }) | PauseSession
          rule f(e: Event) -> Int
          match e {
            LogSet(p) -> p.reps,
            PauseSession -> p.reps
          }
        `);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it("AC1.8: guard-only coverage fails exhaustiveness", () => {
        const result = checkRuleSource(`
          type Event = Start | Pause | Stop
          rule f(e: Event) -> Int
          match e {
            Start if false -> 1,
            Pause -> 2,
            Stop -> 3
          }
        `);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toMatch(/missing|exhaustiv/i);
      });

      it("AC1.8: only guarded Pause is not exhaustive", () => {
        const result = checkRuleSource(`
          type Event = Start | Pause
          rule f(e: Event) -> Int
          match e {
            Start -> 1,
            Pause if true -> 2
          }
        `);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it("AC4.1: Option match missing None fails", () => {
        const result = checkRuleSource(`
          rule f(o: Option(Int)) -> Int
          match o { Some(x) -> x }
        `);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toMatch(/missing|exhaustiv/i);
      });

      it("parse error in guard surfaces through checkRuleSource", () => {
        const result = checkRuleSource(`
          rule f(x: Int) -> Int
          match x { 1 if f(x)? -> 2, _ -> 0 }
        `);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe("Task 6: Module system integration", () => {
      it("backwards compatible: no options = no-import behavior", () => {
        const result = checkRuleSource(`
          rule f(x: Int) -> Int
          x + 1
        `);
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it("import without resolver → clear error", () => {
        const result = checkRuleSource(`
          import "helpers" as h
          rule f(x: Int) -> Int
          x + 1
        `);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toMatch(/import|resolver/i);
      });

      it("rule header can reference imported types", () => {
        const helperSource = `
          type Stage = Idle | Working
          let dummy = 1
          0
        `;
        const resolver = (path: string) => {
          if (path === "helpers") return helperSource;
          throw new Error(`Unknown import: ${path}`);
        };
        const result = checkRuleSource(
          `
          import "helpers" as h
          rule f(s: Stage) -> String
          match s { Idle -> "idle", Working -> "working" }
          `,
          { resolve: resolver, path: "entry" }
        );
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.header!.name).toBe("f");
      });

      it("broken helper → ok:false located in helper", () => {
        const helperSource = `
          type Stage = Idle | Working
          let broken = 1 + "x"
          0
        `;
        const resolver = (path: string) => {
          if (path === "helpers") return helperSource;
          throw new Error(`Unknown import: ${path}`);
        };
        const result = checkRuleSource(
          `
          import "helpers" as h
          rule f(x: Int) -> Int
          x + 1
          `,
          { resolve: resolver, path: "entry" }
        );
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toMatch(/helpers/);
      });

      it("import cycle → ok:false with full chain", () => {
        const aSource = `import "b" as b\nlet a = 1\n0`;
        const bSource = `import "a" as a\nlet b = 2\n0`;
        const resolver = (path: string) => {
          if (path === "a") return aSource;
          if (path === "b") return bSource;
          throw new Error(`Unknown import: ${path}`);
        };
        const result = checkRuleSource(
          `
          import "a" as a
          rule f(x: Int) -> Int
          x + 1
          `,
          { resolve: resolver, path: "entry" }
        );
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toMatch(/cycle|->.*->.*->/);
      });

      it("qualified value access in rule body", () => {
        const helperSource = `
          let add = fn(a) -> fn(b) -> a + b
          0
        `;
        const resolver = (path: string) => {
          if (path === "helpers") return helperSource;
          throw new Error(`Unknown import: ${path}`);
        };
        const result = checkRuleSource(
          `
          import "helpers" as h
          rule f(x: Int) -> Int
          h.add(x)(1)
          `,
          { resolve: resolver, path: "entry" }
        );
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it("unknown module export → error naming available exports", () => {
        const helperSource = `
          let add(a: Int, b: Int) = a + b
          0
        `;
        const resolver = (path: string) => {
          if (path === "helpers") return helperSource;
          throw new Error(`Unknown import: ${path}`);
        };
        const result = checkRuleSource(
          `
          import "helpers" as h
          rule f(x: Int) -> Int
          h.nonexistent(x, 1)
          `,
          { resolve: resolver, path: "entry" }
        );
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it("BUG 1: alias references in constructor payload types are resolved", () => {
        const result = checkRuleSource(`
          alias A = { n: Int }
          type E = Mk({ a: A })
          rule f(e: E) -> Int
          match e { Mk(p) -> p.a.n }
        `);
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it("BUG 1: List(alias) in constructor payload is resolved", () => {
        const result = checkRuleSource(`
          alias Item = { value: Int }
          type Container = Hold(List(Item))
          rule f(c: Container) -> Int
          match c { Hold(items) -> length(items) }
        `);
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it("BUG 1: aliased union member in constructor payload is resolved", () => {
        const helperSource = `
          let dummy = 1
          0
        `;
        const resolver = (path: string) => {
          if (path === "helpers") return helperSource;
          throw new Error(`Unknown import: ${path}`);
        };
        const result = checkRuleSource(
          `
          import "helpers" as h
          alias ItemPayload = { id: Int, name: String }
          type Item = Create(ItemPayload) | Delete(Int)
          rule f(item: Item) -> String
          match item { Create(p) -> p.name, Delete(_) -> "" }
          `,
          { resolve: resolver, path: "entry" }
        );
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it("BUG 2: entry with imports AND own declarations does not duplicate", () => {
        const helperSource = `
          let f = fn(x) -> x + 1
          0
        `;
        const resolver = (path: string) => {
          if (path === "helpers") return helperSource;
          throw new Error(`Unknown import: ${path}`);
        };
        const result = checkRuleSource(
          `
          import "helpers" as h
          type P = A | B
          rule main(p: P) -> Int
          match p { A -> h.f(1), B -> 0 }
          `,
          { resolve: resolver, path: "entry" }
        );
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
      });
    });
  });
});
