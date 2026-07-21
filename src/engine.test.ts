import { describe, it, expect } from "vitest";
import { createEngine, TransitionError } from "./engine";
import { EngineConfig } from "./engine";

describe("Task 4: createEngine construction gate", () => {
  describe("broken entry rule", () => {
    it("throws with rule error text when entry rule has type error", () => {
      const config: EngineConfig<{ count: number }, { type: string }> = {
        resolve: () => `
          rule transition(state: { count: Int }, event: { type: String }) -> Result({ state: { count: Int }, effects: List(Unit) })
          bad_expression_undefined
        `,
        entry: "transition.rill",
        initialState: { count: 0 },
        executors: {},
      };

      expect(() => createEngine(config)).toThrow();
    });
  });

  describe("wrong header shape", () => {
    it("throws when rule has only 1 parameter instead of 2", () => {
      const config: EngineConfig<{ count: number }, { type: string }> = {
        resolve: () => `
          rule transition(state: { count: Int }) -> Result({ state: { count: Int }, effects: List(Unit) })
          Ok({ state: state, effects: [] })
        `,
        entry: "transition.rill",
        initialState: { count: 0 },
        executors: {},
      };

      expect(() => createEngine(config)).toThrow(/2.*param|exactly.*2|require.*2/i);
    });

    it("throws when rule has 3 parameters", () => {
      const config: EngineConfig<number, string> = {
        resolve: () => `
          rule transition(a: Int, b: String, c: Bool) -> Result(Int)
          Ok(1)
        `,
        entry: "transition.rill",
        initialState: 0,
        executors: {},
      };

      expect(() => createEngine(config)).toThrow(/2.*param|exactly.*2|require.*2/i);
    });

    it("throws when return type is not Result", () => {
      const config: EngineConfig<number, string> = {
        resolve: () => `
          rule transition(state: Int, event: String) -> Int
          state
        `,
        entry: "transition.rill",
        initialState: 0,
        executors: {},
      };

      expect(() => createEngine(config)).toThrow(/Result|return/i);
    });

    it("throws when Result doesn't have state and effects fields", () => {
      const config: EngineConfig<number, string> = {
        resolve: () => `
          rule transition(state: Int, event: String) -> Result({ foo: Int, bar: String })
          Ok({ foo: 1, bar: "x" })
        `,
        entry: "transition.rill",
        initialState: 0,
        executors: {},
      };

      expect(() => createEngine(config)).toThrow(/state.*effects|Result.*fields/i);
    });
  });

  describe("good rule construction", () => {
    it("constructs engine with valid rule and getState returns initialState", () => {
      const config: EngineConfig<number, string> = {
        resolve: () => `
          rule transition(state: Int, event: String) -> Result({ state: Int, effects: List(Unit) })
          Ok({ state: state, effects: [] })
        `,
        entry: "transition.rill",
        initialState: 42,
        executors: {},
      };

      const engine = createEngine(config);
      expect(engine.getState()).toBe(42);
    });
  });
});
