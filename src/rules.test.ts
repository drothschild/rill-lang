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
      // This test will pass once Task 8-11 implement TUnion support in the typechecker.
      // For now, Result is parsed as TUnion("Result", [...]) but the typechecker
      // doesn't know how to handle TUnion yet.
      const result = checkRuleSource(`
        rule validation(job: { company_name: String, role: String, salary_min: Int, salary_max: Int }) -> Result(String)
        let _ = require(str_len(job.company_name) > 0, "Company name is required")?
        Ok("valid")
      `);
      // Currently fails because typechecker doesn't support TUnion yet (Task 8+)
      expect(result.ok).toBe(false);
    });
  });
});
