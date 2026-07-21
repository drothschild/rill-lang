import { describe, it, expect, beforeEach } from "vitest";
import { Type, resetTypeVarCounter } from "./types";
import {
  buildDeclEnv,
  resolveTypeAnn,
  instantiateCtor,
  suggestName,
  createPreludeDeclEnv,
} from "./decls";
import { TypeDecl, AliasDecl } from "./ast";
import { parseProgram } from "./parser";
import { lex } from "./lexer";
import { RillError } from "./errors";

describe("Declaration Environment", () => {
  beforeEach(() => resetTypeVarCounter());

  describe("buildDeclEnv", () => {
    it("builds env from simple union declarations", () => {
      const source = `
        type Phase = Idle | Warmup | Working
        1
      `;
      const ast = parseProgram(lex(source));
      const env = buildDeclEnv(ast.declarations);

      expect(env.unions.has("Phase")).toBe(true);
      const phase = env.unions.get("Phase")!;
      expect(phase.params).toEqual([]);
      expect(phase.ctors).toEqual(["Idle", "Warmup", "Working"]);

      expect(env.ctors.has("Idle")).toBe(true);
      expect(env.ctors.get("Idle")!.union).toBe("Phase");
      expect(env.ctors.get("Idle")!.payload).toBe(null);
    });

    it("builds env from union with payloads", () => {
      const source = `
        type Event = | StartSession({ sessionId: String }) | SetDone({ nowMs: Int })
        1
      `;
      const ast = parseProgram(lex(source));
      const env = buildDeclEnv(ast.declarations);

      expect(env.ctors.has("StartSession")).toBe(true);
      const ctorInfo = env.ctors.get("StartSession")!;
      expect(ctorInfo.union).toBe("Event");
      expect(ctorInfo.payload).not.toBe(null);
      if (ctorInfo.payload) {
        expect(ctorInfo.payload.kind).toBe("TRecord");
      }
    });

    it("builds env from parametric union", () => {
      const source = `
        type Option(a) = Some(a) | None
        1
      `;
      const ast = parseProgram(lex(source));
      const env = buildDeclEnv(ast.declarations);

      const option = env.unions.get("Option")!;
      expect(option.params).toEqual(["a"]);
      expect(option.ctors).toEqual(["Some", "None"]);

      const someInfo = env.ctors.get("Some")!;
      expect(someInfo.typeParams).toEqual(["a"]);
      expect(someInfo.payload?.kind).toBe("TParam");
      if (someInfo.payload?.kind === "TParam") {
        expect(someInfo.payload.name).toBe("a");
      }
    });

    it("rejects duplicate constructor across types", () => {
      const source = `
        type A = X
        type B = X
        1
      `;
      const ast = parseProgram(lex(source));
      expect(() => buildDeclEnv(ast.declarations)).toThrow(/X.*A.*B|X.*B.*A/);
    });

    it("rejects duplicate type name", () => {
      const source = `
        type Phase = Idle
        type Phase = Working
        1
      `;
      const ast = parseProgram(lex(source));
      expect(() => buildDeclEnv(ast.declarations)).toThrow();
    });
  });

  describe("resolveTypeAnn", () => {
    it("expands alias references", () => {
      const source = `
        alias S = { phase: Phase }
        type Phase = Idle | Working
        1
      `;
      const ast = parseProgram(lex(source));
      const env = buildDeclEnv(ast.declarations);

      const aliasType = env.aliases.get("S")!.type;
      const resolved = resolveTypeAnn(aliasType, env);
      expect(resolved.kind).toBe("TRecord");
    });

    it("validates union arity", () => {
      const source = `
        type Option(a) = Some(a) | None
        1
      `;
      const ast = parseProgram(lex(source));
      const env = buildDeclEnv(ast.declarations);

      const twoArgUnion: Type = { kind: "TUnion", name: "Option", args: [{ kind: "TCon", name: "Int" }, { kind: "TCon", name: "String" }] };
      expect(() => resolveTypeAnn(twoArgUnion, env)).toThrow();
    });

    it("detects unknown type with did-you-mean suggestion", () => {
      const source = `
        type Circle = C
        1
      `;
      const ast = parseProgram(lex(source));
      const env = buildDeclEnv(ast.declarations);

      const unknownType: Type = { kind: "TUnion", name: "Circl", args: [] };
      expect(() => resolveTypeAnn(unknownType, env)).toThrow(/Circl|Circle/);
    });

    it("allows TParam in active params", () => {
      const source = `
        type Option(a) = Some(a) | None
        1
      `;
      const ast = parseProgram(lex(source));
      const env = buildDeclEnv(ast.declarations);

      const paramType: Type = { kind: "TParam", name: "a" };
      const resolved = resolveTypeAnn(paramType, env, ["a"]);
      expect(resolved).toEqual(paramType);
    });

    it("rejects TParam outside active params", () => {
      const source = `
        type Option(a) = Some(a) | None
        1
      `;
      const ast = parseProgram(lex(source));
      const env = buildDeclEnv(ast.declarations);

      const paramType: Type = { kind: "TParam", name: "b" };
      expect(() => resolveTypeAnn(paramType, env, ["a"])).toThrow();
    });

    it("rejects unknown lowercase type names", () => {
      const source = `
        type Phase = Idle | Working
        1
      `;
      const ast = parseProgram(lex(source));
      const env = buildDeclEnv(ast.declarations);

      const unknownType: Type = { kind: "TCon", name: "unknownType" };
      expect(() => resolveTypeAnn(unknownType, env)).toThrow();
    });
  });

  describe("instantiateCtor", () => {
    it("instantiates constructor with fresh vars", () => {
      const source = `
        type Option(a) = Some(a) | None
        1
      `;
      const ast = parseProgram(lex(source));
      const env = buildDeclEnv(ast.declarations);

      const someInfo = env.ctors.get("Some")!;
      const inst1 = instantiateCtor(someInfo, env);
      const inst2 = instantiateCtor(someInfo, env);

      expect(inst1.payload?.kind).toBe("TVar");
      expect(inst2.payload?.kind).toBe("TVar");

      const payload1 = inst1.payload as { kind: "TVar"; id: number };
      const payload2 = inst2.payload as { kind: "TVar"; id: number };
      expect(payload1.id).not.toBe(payload2.id);
    });

    it("preserves nullary constructor payload", () => {
      const source = `
        type Option(a) = Some(a) | None
        1
      `;
      const ast = parseProgram(lex(source));
      const env = buildDeclEnv(ast.declarations);

      const noneInfo = env.ctors.get("None")!;
      const inst = instantiateCtor(noneInfo, env);
      expect(inst.payload).toBe(null);
    });

    it("var in payload matches var in unionType", () => {
      const source = `
        type Option(a) = Some(a) | None
        1
      `;
      const ast = parseProgram(lex(source));
      const env = buildDeclEnv(ast.declarations);

      const someInfo = env.ctors.get("Some")!;
      const inst = instantiateCtor(someInfo, env);

      const unionType = inst.unionType as { kind: "TUnion"; name: string; args: Type[] };
      expect(unionType.args[0]).toEqual(inst.payload);
    });
  });

  describe("suggestName", () => {
    it("suggests close match by Levenshtein distance", () => {
      const suggestion = suggestName("Circl", ["Circle", "Region"]);
      expect(suggestion).toBe("Circle");
    });

    it("returns null when no close match", () => {
      const suggestion = suggestName("Xyz", ["Circle", "Region"]);
      expect(suggestion).toBeNull();
    });

    it("ignores matches beyond distance 2", () => {
      const suggestion = suggestName("abc", ["xyz"]);
      expect(suggestion).toBeNull();
    });
  });

  describe("createPreludeDeclEnv", () => {
    it("contains Result union with correct structure", () => {
      const env = createPreludeDeclEnv();

      expect(env.unions.has("Result")).toBe(true);
      const result = env.unions.get("Result")!;
      expect(result.params).toEqual(["a"]);
      expect(result.ctors.sort()).toEqual(["Err", "Ok"]);

      const okInfo = env.ctors.get("Ok")!;
      expect(okInfo.union).toBe("Result");
      expect(okInfo.payload?.kind).toBe("TParam");

      const errInfo = env.ctors.get("Err")!;
      expect(errInfo.union).toBe("Result");
      expect(errInfo.payload?.kind).toBe("TCon");
      if (errInfo.payload?.kind === "TCon") {
        expect(errInfo.payload.name).toBe("String");
      }
    });

    it("contains Option union with correct structure", () => {
      const env = createPreludeDeclEnv();

      expect(env.unions.has("Option")).toBe(true);
      const option = env.unions.get("Option")!;
      expect(option.params).toEqual(["a"]);
      expect(option.ctors.sort()).toEqual(["None", "Some"]);

      const someInfo = env.ctors.get("Some")!;
      expect(someInfo.union).toBe("Option");
      expect(someInfo.payload?.kind).toBe("TParam");

      const noneInfo = env.ctors.get("None")!;
      expect(noneInfo.union).toBe("Option");
      expect(noneInfo.payload).toBe(null);
    });
  });
});
