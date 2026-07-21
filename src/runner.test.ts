import { describe, it, expect } from "vitest";
import { runSource } from "./runner";

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
});
