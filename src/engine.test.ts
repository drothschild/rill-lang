import { describe, it, expect, vi, afterEach } from "vitest";
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

  describe("alias resolution", () => {
    it("constructs engine when return type is Result(alias) that resolves to record with state and effects", () => {
      const config: EngineConfig<number, { n: number }> = {
        resolve: () => `
          type Ev = Go({ n: Int }) | Stop
          type Eff = Ping
          alias St = { count: Int }
          alias TR = { state: St, effects: List(Eff) }
          rule transition(state: St, event: Ev) -> Result(TR)
          match event {
            Go(p) -> Ok({ state: { state | count: state.count + p.n }, effects: [Ping] }),
            Stop -> Ok({ state: state, effects: [] })
          }
        `,
        entry: "transition.rill",
        initialState: { count: 0 },
        executors: { Ping: () => {} },
      };

      const engine = createEngine(config);
      expect(engine.getState()).toEqual({ count: 0 });
    });

    it("dispatches correctly with aliased return type and union event type", () => {
      const pingCalls: any[] = [];
      const config: EngineConfig<{ count: number }, { tag: string; value?: any }> = {
        resolve: () => `
          type Ev = Go({ n: Int }) | Stop
          type Eff = Ping
          alias St = { count: Int }
          alias TR = { state: St, effects: List(Eff) }
          rule transition(state: St, event: Ev) -> Result(TR)
          match event {
            Go(p) -> Ok({ state: { state | count: state.count + p.n }, effects: [Ping] }),
            Stop -> Ok({ state: state, effects: [] })
          }
        `,
        entry: "transition.rill",
        initialState: { count: 1 },
        executors: { Ping: (payload) => pingCalls.push(payload) },
      };

      const engine = createEngine(config);
      const result = engine.dispatch({ tag: "Go", value: { n: 4 } });
      expect(result).toEqual({ count: 5 });
      expect(engine.getState()).toEqual({ count: 5 });
      expect(pingCalls).toHaveLength(1);
      expect(pingCalls[0]).toBeUndefined();
    });

    it("constructs engine with nested alias in state type", () => {
      const config: EngineConfig<{ current: { n: number } }, string> = {
        resolve: () => `
          alias Inner = { n: Int }
          alias St = { current: Inner }
          alias TR = { state: St, effects: List(Unit) }
          rule transition(state: St, event: String) -> Result(TR)
          Ok({ state: state, effects: [] })
        `,
        entry: "transition.rill",
        initialState: { current: { n: 42 } },
        executors: {},
      };

      const engine = createEngine(config);
      expect(engine.getState()).toEqual({ current: { n: 42 } });
    });
  });
});

describe("Task 5: dispatch — state swap, executor fan-out, and Err preservation", () => {
  describe("Ok path: state swap and executor invocation", () => {
    it("dispatch returns new state and swaps internal state", () => {
      const config: EngineConfig<number, string> = {
        resolve: () => `
          rule transition(state: Int, event: String) -> Result({ state: Int, effects: List(Unit) })
          Ok({ state: state + 1, effects: [] })
        `,
        entry: "transition.rill",
        initialState: 10,
        executors: {},
      };

      const engine = createEngine(config);
      const result = engine.dispatch("anything");
      expect(result).toBe(11);
      expect(engine.getState()).toBe(11);
    });

    it("invokes executor for Ping effect (no payload) in effect list", () => {
      const pingExecutor = vi.fn();
      const config: EngineConfig<number, string> = {
        resolve: () => `
          type Effect = Ping | Sched({ ms: Int })
          rule transition(state: Int, event: String) -> Result({ state: Int, effects: List(Effect) })
          Ok({ state: state + 1, effects: [Ping] })
        `,
        entry: "transition.rill",
        initialState: 0,
        executors: { Ping: pingExecutor },
      };

      const engine = createEngine(config);
      engine.dispatch("event1");
      expect(pingExecutor).toHaveBeenCalledOnce();
      expect(pingExecutor).toHaveBeenCalledWith(undefined);
    });

    it("invokes executor for Sched effect (with payload) in effect list", () => {
      const schedExecutor = vi.fn();
      const config: EngineConfig<number, string> = {
        resolve: () => `
          type Effect = Ping | Sched({ ms: Int })
          rule transition(state: Int, event: String) -> Result({ state: Int, effects: List(Effect) })
          Ok({ state: state + 1, effects: [Sched({ ms: 100 })] })
        `,
        entry: "transition.rill",
        initialState: 0,
        executors: { Sched: schedExecutor },
      };

      const engine = createEngine(config);
      engine.dispatch("event1");
      expect(schedExecutor).toHaveBeenCalledOnce();
      expect(schedExecutor).toHaveBeenCalledWith({ ms: 100 });
    });

    it("invokes executors in effect-list order", () => {
      const callOrder: string[] = [];
      const config: EngineConfig<number, string> = {
        resolve: () => `
          type Effect = First | Second | Third
          rule transition(state: Int, event: String) -> Result({ state: Int, effects: List(Effect) })
          Ok({ state: state, effects: [First, Second, Third] })
        `,
        entry: "transition.rill",
        initialState: 0,
        executors: {
          First: () => callOrder.push("First"),
          Second: () => callOrder.push("Second"),
          Third: () => callOrder.push("Third"),
        },
      };

      const engine = createEngine(config);
      engine.dispatch("event1");
      expect(callOrder).toEqual(["First", "Second", "Third"]);
    });

    it("throws TransitionError when effect has no registered executor", () => {
      const config: EngineConfig<number, string> = {
        resolve: () => `
          type Effect = Known | Unknown
          rule transition(state: Int, event: String) -> Result({ state: Int, effects: List(Effect) })
          Ok({ state: state + 1, effects: [Unknown] })
        `,
        entry: "transition.rill",
        initialState: 0,
        executors: { Known: () => {} },
      };

      const engine = createEngine(config);
      expect(() => engine.dispatch("event1")).toThrow(TransitionError);
      expect(() => engine.dispatch("event1")).toThrow(/Unknown/);
    });

    it("event bridging: converts event value against declared type", () => {
      const executor = vi.fn();
      const config: EngineConfig<number, number> = {
        resolve: () => `
          rule transition(state: Int, event: Float) -> Result({ state: Int, effects: List(Unit) })
          Ok({ state: state + 1, effects: [] })
        `,
        entry: "transition.rill",
        initialState: 0,
        executors: {},
      };

      const engine = createEngine(config);
      const result = engine.dispatch(42); // JS int -> Float
      expect(result).toBe(1);
    });
  });

  describe("Err path: preserve state, no executors", () => {
    it("throws TransitionError with Err message, state unchanged", () => {
      const executor = vi.fn();
      const config: EngineConfig<number, string> = {
        resolve: () => `
          rule transition(state: Int, event: String) -> Result({ state: Int, effects: List(Unit) })
          match event {
            "fail" -> Err("transition failed"),
            _ -> Ok({ state: state + 1, effects: [] })
          }
        `,
        entry: "transition.rill",
        initialState: 10,
        executors: { SomeEffect: executor },
      };

      const engine = createEngine(config);
      expect(() => engine.dispatch("fail")).toThrow(TransitionError);
      expect(() => engine.dispatch("fail")).toThrow(/transition failed/);
      expect(engine.getState()).toBe(10);
      expect(executor).not.toHaveBeenCalled();
    });
  });

  describe("async executor semantics", () => {
    it("async executor rejection routes to onExecutorError callback", async () => {
      const onExecutorError = vi.fn();
      const testError = new Error("async executor failed");
      const config: EngineConfig<number, string> = {
        resolve: () => `
          type Effect = AsyncOp
          rule transition(state: Int, event: String) -> Result({ state: Int, effects: List(Effect) })
          Ok({ state: state + 1, effects: [AsyncOp] })
        `,
        entry: "transition.rill",
        initialState: 0,
        executors: {
          AsyncOp: async () => {
            throw testError;
          },
        },
        onExecutorError,
      };

      const engine = createEngine(config);
      const result = engine.dispatch("event");
      expect(result).toBe(1); // State swapped immediately
      expect(onExecutorError).not.toHaveBeenCalled(); // Not called yet (async)
      await new Promise(setImmediate); // Flush microtask queue
      expect(onExecutorError).toHaveBeenCalledOnce();
      expect(onExecutorError).toHaveBeenCalledWith(testError, "AsyncOp");
    });

    it("async executor rejection is rethrown on microtask queue when no onExecutorError", async () => {
      const unhandledRejections: unknown[] = [];
      const handler = (reason: unknown) => {
        unhandledRejections.push(reason);
      };

      try {
        process.on("unhandledRejection", handler);

        const testError = new Error("unhandled async error");
        const config: EngineConfig<number, string> = {
          resolve: () => `
            type Effect = AsyncOp
            rule transition(state: Int, event: String) -> Result({ state: Int, effects: List(Effect) })
            Ok({ state: state + 1, effects: [AsyncOp] })
          `,
          entry: "transition.rill",
          initialState: 0,
          executors: {
            AsyncOp: async () => {
              throw testError;
            },
          },
        };

        const engine = createEngine(config);
        const result = engine.dispatch("event");
        expect(result).toBe(1); // State swapped immediately
        await new Promise(setImmediate); // Flush microtask queue
        expect(unhandledRejections).toContain(testError);
      } finally {
        process.off("unhandledRejection", handler);
      }
    });

    it("sync executor throw propagates out of dispatch, state remains swapped", () => {
      const testError = new Error("sync executor error");
      const config: EngineConfig<number, string> = {
        resolve: () => `
          type Effect = SyncOp
          rule transition(state: Int, event: String) -> Result({ state: Int, effects: List(Effect) })
          Ok({ state: state + 1, effects: [SyncOp] })
        `,
        entry: "transition.rill",
        initialState: 0,
        executors: {
          SyncOp: () => {
            throw testError;
          },
        },
      };

      const engine = createEngine(config);
      expect(() => engine.dispatch("event")).toThrow(testError);
      expect(engine.getState()).toBe(1); // State was swapped before executor threw
    });
  });

  describe("multi-module dispatch (CRITICAL 1: imported module values)", () => {
    it("entry rule can import and use helper module bindings", () => {
      const config: EngineConfig<number, number> = {
        resolve: (path: string, fromPath?: string) => {
          if (path === "helpers") {
            return `
              let increment = 1
              increment
            `;
          }
          return `
            import "helpers" as h
            rule transition(state: Int, event: Int) -> Result({ state: Int, effects: List(Unit) })
            Ok({ state: state + h.increment + event, effects: [] })
          `;
        },
        entry: "transition",
        initialState: 10,
        executors: {},
      };

      const engine = createEngine(config);
      const result = engine.dispatch(5);
      expect(result).toBe(16); // 10 + 1 (increment) + 5
      expect(engine.getState()).toBe(16);
    });
  });
});
