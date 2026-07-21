import { describe, it, expect } from "vitest";
import { loadModules, buildGraphDeclEnv } from "./modules";
import { lex } from "./lexer";
import { RillError } from "./errors";

describe("Module Loader", () => {
  describe("linear chains", () => {
    it("loads a linear chain a->b->c", () => {
      const sources: { [key: string]: string } = {
        c: "42",
        b: 'import "c" as c_mod\n42',
        a: 'import "b" as b_mod\n42',
      };

      const resolver = (path: string) => {
        const src = sources[path];
        if (!src) throw new Error(`Module not found: ${path}`);
        return src;
      };

      const result = loadModules(sources.a, "a", resolver);

      expect(result.modules.size).toBe(3);
      expect(result.order).toEqual(["c", "b", "a"]);
      expect(result.modules.get("c")).toBeDefined();
      expect(result.modules.get("b")).toBeDefined();
      expect(result.modules.get("a")).toBeDefined();
    });
  });

  describe("cycle detection", () => {
    it("detects a cycle a->b->a", () => {
      const sources: { [key: string]: string } = {
        a: 'import "b" as b_mod\n42',
        b: 'import "a" as a_mod\n42',
      };

      const resolver = (path: string) => {
        const src = sources[path];
        if (!src) throw new Error(`Module not found: ${path}`);
        return src;
      };

      expect(() => loadModules(sources.a, "a", resolver)).toThrow(/Import cycle: a -> b -> a/);
    });

    it("detects a self-import a->a", () => {
      const sources: { [key: string]: string } = {
        a: 'import "a" as a_mod\n42',
      };

      const resolver = (path: string) => {
        const src = sources[path];
        if (!src) throw new Error(`Module not found: ${path}`);
        return src;
      };

      expect(() => loadModules(sources.a, "a", resolver)).toThrow(/Import cycle: a -> a/);
    });
  });

  describe("diamond imports", () => {
    it("loads a diamond entry->{x,y}, x->shared, y->shared: shared loads once", () => {
      const sources: { [key: string]: string } = {
        shared: "42",
        x: 'import "shared" as shared_mod\n42',
        y: 'import "shared" as shared_mod\n42',
        entry: 'import "x" as x_mod\nimport "y" as y_mod\n42',
      };

      const resolver = (path: string) => {
        const src = sources[path];
        if (!src) throw new Error(`Module not found: ${path}`);
        return src;
      };

      const result = loadModules(sources.entry, "entry", resolver);

      expect(result.modules.size).toBe(4);
      expect(result.modules.has("shared")).toBe(true);
      expect(result.modules.has("x")).toBe(true);
      expect(result.modules.has("y")).toBe(true);
      expect(result.modules.has("entry")).toBe(true);
      // shared should appear before x and y in topological order
      const sharedIdx = result.order.indexOf("shared");
      const xIdx = result.order.indexOf("x");
      const yIdx = result.order.indexOf("y");
      expect(sharedIdx < xIdx).toBe(true);
      expect(sharedIdx < yIdx).toBe(true);
    });
  });

  describe("resolver errors", () => {
    it("wraps resolver throw with path and importer context", () => {
      const sources: { [key: string]: string } = {
        entry: 'import "missing" as m\n42',
      };

      const resolver = (path: string) => {
        const src = sources[path];
        if (!src) throw new Error(`Module not found: ${path}`);
        return src;
      };

      expect(() => loadModules(sources.entry, "entry", resolver)).toThrow(/missing/);
    });
  });
});

describe("Declaration Environment Merging", () => {
  describe("buildGraphDeclEnv", () => {
    it("merges type declarations from modules in topological order", () => {
      const sources: { [key: string]: string } = {
        t: "type Phase = Idle | Working\n42",
        entry: 'import "t" as t\n42',
      };

      const resolver = (path: string) => {
        const src = sources[path];
        if (!src) throw new Error(`Module not found: ${path}`);
        return src;
      };

      const graph = loadModules(sources.entry, "entry", resolver);
      const declEnv = buildGraphDeclEnv(graph);

      expect(declEnv.unions.has("Phase")).toBe(true);
      expect(declEnv.ctors.has("Idle")).toBe(true);
      expect(declEnv.ctors.has("Working")).toBe(true);
    });

    it("detects collision of same type name across modules", () => {
      const sources: { [key: string]: string } = {
        x: "type Phase = Idle | Working\n42",
        y: "type Phase = Setup | Running\n42",
        entry: 'import "x" as x\nimport "y" as y\n42',
      };

      const resolver = (path: string) => {
        const src = sources[path];
        if (!src) throw new Error(`Module not found: ${path}`);
        return src;
      };

      const graph = loadModules(sources.entry, "entry", resolver);
      expect(() => buildGraphDeclEnv(graph)).toThrow();
      expect(() => buildGraphDeclEnv(graph)).toThrow(/Phase/);
    });

    it("detects collision with prelude (type Result)", () => {
      const sources: { [key: string]: string } = {
        m: "type Result = Good | Bad\n42",
        entry: 'import "m" as m\n42',
      };

      const resolver = (path: string) => {
        const src = sources[path];
        if (!src) throw new Error(`Module not found: ${path}`);
        return src;
      };

      const graph = loadModules(sources.entry, "entry", resolver);
      expect(() => buildGraphDeclEnv(graph)).toThrow();
      expect(() => buildGraphDeclEnv(graph)).toThrow(/Result/);
    });

    it("detects collision of constructor names across modules", () => {
      const sources: { [key: string]: string } = {
        x: "type Status = Idle | Working\n42",
        y: "type State = Idle | Done\n42",
        entry: 'import "x" as x\nimport "y" as y\n42',
      };

      const resolver = (path: string) => {
        const src = sources[path];
        if (!src) throw new Error(`Module not found: ${path}`);
        return src;
      };

      const graph = loadModules(sources.entry, "entry", resolver);
      expect(() => buildGraphDeclEnv(graph)).toThrow();
      expect(() => buildGraphDeclEnv(graph)).toThrow(/Idle/);
    });
  });
});
