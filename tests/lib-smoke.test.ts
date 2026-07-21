import { describe, it, expect } from "vitest";
// Import from the BUILT package entry, exactly as a consumer would.
import { infer, createPreludeTypeEnv, bindType, T, lex, parse, jsToRill, rillToJs, BridgeError, createPreludeDeclEnv, createEngine, TransitionError } from "../dist/lib.js";

describe("built lib.js checking API", () => {
  it("exports the checking API as callable values", () => {
    expect(typeof infer).toBe("function");
    expect(typeof createPreludeTypeEnv).toBe("function");
    expect(typeof bindType).toBe("function");
    expect(typeof T.record).toBe("function");
    expect(typeof T.list).toBe("function");
  });

  it("type-checks a trivial open-record program via the public API", () => {
    // Signature: r is an OPEN record; reading r.a (an Int field) must type-check.
    let env = createPreludeTypeEnv();
    env = bindType(env, "r", T.record({ a: T.Int }, true));
    // A program that reads a declared field off the open record.
    expect(() => infer(parse(lex("r.a")), env, "r.a")).not.toThrow();
    // Reading an undeclared field off the OPEN record also type-checks (row grows).
    expect(() => infer(parse(lex("r.b")), env, "r.b")).not.toThrow();
  });
});

describe("built lib.js bridge API (Phase 5)", () => {
  it("exports rillToJs and jsToRill as callable functions", () => {
    expect(typeof rillToJs).toBe("function");
    expect(typeof jsToRill).toBe("function");
  });

  it("exports BridgeError as a class", () => {
    expect(typeof BridgeError).toBe("function");
    const err = new BridgeError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("converts Rill Int value to JS number via rillToJs", () => {
    const result = rillToJs({ kind: "Int", value: 42 });
    expect(result).toBe(42);
  });

  it("converts JS number to Rill Int via jsToRill with prelude env", () => {
    const env = createPreludeDeclEnv();
    const result = jsToRill(42, T.Int, env, "value");
    expect(result).toEqual({ kind: "Int", value: 42 });
  });

  it("converts Rill tag value via rillToJs", () => {
    const result = rillToJs({
      kind: "Tag",
      tag: "Ok",
      args: [{ kind: "Int", value: 42 }],
    });
    expect(result).toEqual({ tag: "Ok", value: 42 });
  });

  it("converts JS tag object to Rill via jsToRill", () => {
    const env = createPreludeDeclEnv();
    const result = jsToRill(
      { tag: "Ok", value: 42 },
      T.union("Result", [T.Int]),
      env,
      "result"
    );
    expect(result).toEqual({
      kind: "Tag",
      tag: "Ok",
      args: [{ kind: "Int", value: 42 }],
    });
  });

  it("round-trips via rillToJs then jsToRill", () => {
    const env = createPreludeDeclEnv();
    const original = { kind: "Int" as const, value: 42 };
    const js = rillToJs(original);
    const roundTrip = jsToRill(js, T.Int, env, "x");
    expect(roundTrip).toEqual(original);
  });
});

describe("built lib.js engine API (Phase 5)", () => {
  it("exports createEngine and TransitionError as callable functions/classes", () => {
    expect(typeof createEngine).toBe("function");
    expect(typeof TransitionError).toBe("function");
  });

  it("TransitionError is an Error subclass", () => {
    const err = new TransitionError("test message");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("test message");
  });

  it("creates an engine and dispatches a transition", () => {
    const engine = createEngine({
      resolve: () => `
        rule transition(state: Int, event: String) -> Result({ state: Int, effects: List(Unit) })
        Ok({ state: state + 1, effects: [] })
      `,
      entry: "transition.rill",
      initialState: 10,
      executors: {},
    });

    expect(engine.getState()).toBe(10);
    const newState = engine.dispatch("event");
    expect(newState).toBe(11);
    expect(engine.getState()).toBe(11);
  });

  it("throws TransitionError on Err result", () => {
    const engine = createEngine({
      resolve: () => `
        rule transition(state: Int, event: String) -> Result({ state: Int, effects: List(Unit) })
        Err("test error")
      `,
      entry: "transition.rill",
      initialState: 0,
      executors: {},
    });

    expect(() => engine.dispatch("event")).toThrow(TransitionError);
    expect(() => engine.dispatch("event")).toThrow("test error");
  });
});
