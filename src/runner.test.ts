import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { runSource } from "./runner";
import { createFsResolver } from "./fsResolver";

describe("File Runner", () => {
  it("runs a complete program", () => {
    const result = runSource(`
      let double = fn(x) -> x * 2
      in [1, 2, 3] |> map(double)
    `);
    expect(result.output).toBe("[2, 4, 6]");
  });

  it("reports type errors before running", () => {
    const result = runSource('5 + "hello"');
    expect(result.error).toBeTruthy();
  });

  it("runs pipeline with error handling", () => {
    const result = runSource(`
      let parse = fn(s) -> match s {
        "42" -> Ok(42),
        _ -> Err("bad")
      }
      in "42" |> parse? |> fn n -> n * 2
    `);
    expect(result.output).toBe("84");
  });

  it("runs a program with declared type constructors", () => {
    const result = runSource(`
      type Phase = Idle | Working
      match Idle { Idle -> 1, Working -> 2 }
    `);
    expect(result.output).toBe("1");
  });

  it("runs a program with aliases", () => {
    const result = runSource(`
      alias Rec = { x: Int, y: Int }
      let r = { x: 1, y: 2 }
      in r.x + r.y
    `);
    expect(result.output).toBe("3");
  });

  it("runs a program with Option type", () => {
    const result = runSource(`
      match Some(42) { Some(x) -> x * 2, None -> 0 }
    `);
    expect(result.output).toBe("84");
  });

  it("rejects a program with unknown type names", () => {
    const result = runSource(`
      rule f(x: Badtype) -> Bool
      true
    `);
    expect(result.error).toBeTruthy();
  });

  it("checks constructor arity at runtime through runSource", () => {
    const result = runSource(`
      type Shape = Circle(Float)
      Circle(1.0)
    `);
    expect(result.output).toBe("Circle(1)");

    const resultWrongArity = runSource(`
      type Shape = Circle(Float)
      Circle()
    `);
    expect(resultWrongArity.error).toBeTruthy();
    expect(resultWrongArity.error).toMatch(/expects.*arguments/i);
  });

  describe("Task 7: Module system with filesystem resolver", () => {
    it("runSource with modules and in-memory resolver", () => {
      const sources = {
        helpers: `
          let double = fn(x) -> x * 2
          0
        `,
        "entry": `
          import "helpers" as h
          [1, 2, 3] |> map(h.double)
        `
      };
      const resolver = (path: string) => {
        if (sources[path]) return sources[path];
        throw new Error(`Unknown import: ${path}`);
      };
      const result = runSource(sources["entry"], {
        resolve: resolver,
        path: "entry"
      });
      expect(result.output).toBe("[2, 4, 6]");
      expect(result.error).toBeFalsy();
    });

    it("runSource with module type definitions", () => {
      const sources = {
        "types": `
          type Status = Active | Inactive
          0
        `,
        "entry": `
          import "types" as t
          match Active { Active -> "on", Inactive -> "off" }
        `
      };
      const resolver = (path: string) => {
        if (sources[path]) return sources[path];
        throw new Error(`Unknown import: ${path}`);
      };
      const result = runSource(sources["entry"], {
        resolve: resolver,
        path: "entry"
      });
      expect(result.output).toBe("\"on\"");
      expect(result.error).toBeFalsy();
    });

    it("runSource without resolver reports clear error on imports", () => {
      const source = `
        import "helpers" as h
        [1, 2, 3] |> map(h.double)
      `;
      const result = runSource(source);
      expect(result.error).toBeTruthy();
      expect(result.error).toMatch(/import|resolver/i);
    });

    it("runSource with createFsResolver handles nested imports from fixtures", () => {
      // Test that a/entry.lv importing "lib/helpers" reads a/lib/helpers.lv correctly
      const fixtureDir = path.join(path.dirname(__filename), "..", "tests", "fixtures", "modules", "nested");

      // Skip test if fixtures don't exist
      if (!fs.existsSync(fixtureDir)) {
        console.log("Skipping fixture test: fixtures not found at", fixtureDir);
        return;
      }

      const entryPath = "entry.lv";
      const entrySource = fs.readFileSync(path.join(fixtureDir, entryPath), "utf-8");

      const resolver = createFsResolver(fixtureDir);
      const result = runSource(entrySource, {
        resolve: resolver,
        path: entryPath
      });

      expect(result.error).toBeFalsy();
      if (result.error) {
        console.log("Error from nested fixture:", result.error);
      }
      expect(result.output).toBe("3");
    });

    it("runSource resolves transitive imports relative to importing file's directory", () => {
      // Test that a/lib/helpers.lv importing "shared" reads a/lib/shared.lv (not a/shared.lv)
      // This verifies that fromPath parameter correctly changes resolution base directory
      const fixtureDir = path.join(path.dirname(__filename), "..", "tests", "fixtures", "modules", "nested");

      if (!fs.existsSync(fixtureDir)) {
        console.log("Skipping transitive import test: fixtures not found at", fixtureDir);
        return;
      }

      // Read and run the entry module which imports lib/helpers which imports shared
      const entryPath = "entry.lv";
      const entrySource = fs.readFileSync(path.join(fixtureDir, entryPath), "utf-8");

      const resolver = createFsResolver(fixtureDir);
      const result = runSource(entrySource, {
        resolve: resolver,
        path: entryPath
      });

      expect(result.error).toBeFalsy();
      if (result.error) {
        console.log("Error from transitive import test:", result.error);
      }
      // The result should be 3 (1 + 2 from shared_util.combine)
      expect(result.output).toBe("3");
    });
  });
});
