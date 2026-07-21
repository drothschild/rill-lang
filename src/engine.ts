import { checkRuleSource } from "./rules";
import { RuleHeader, parseProgram } from "./parser";
import { Resolver, loadModules, buildGraphDeclEnv } from "./modules";
import { jsToRill, rillToJs } from "./bridge";
import { Value } from "./values";
import { createPrelude } from "./prelude";
import { evaluate } from "./evaluator";
import { Expr } from "./ast";
import { lex } from "./lexer";

/**
 * Configuration for creating a state machine engine.
 */
export interface EngineConfig<State, Event> {
  resolve: Resolver;
  entry: string;
  initialState: State;
  executors: Record<string, (payload: unknown) => void | Promise<void>>;
  onExecutorError?: (err: unknown, effectTag: string) => void;
}

/**
 * A state machine engine that handles state transitions and effect execution.
 */
export interface Engine<State, Event> {
  dispatch(event: Event): State;
  getState(): State;
}

/**
 * Error thrown when a state transition fails.
 * Carries the Rill error message from an Err result.
 */
export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

/**
 * Creates a state machine engine.
 *
 * Construction validates the entry rule:
 * - Checks the rule source via checkRuleSource
 * - Validates the rule header has exactly 2 parameters
 * - Validates the return type is Result with state and effects fields
 *
 * @param config Engine configuration
 * @returns An Engine instance
 * @throws Error if the entry rule is invalid or missing/malformed
 */
export function createEngine<State, Event>(
  config: EngineConfig<State, Event>
): Engine<State, Event> {
  // Resolve the entry rule source
  let entrySource: string;
  try {
    entrySource = config.resolve(config.entry);
  } catch (error) {
    throw new Error(
      `Failed to resolve entry rule "${config.entry}": ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Check the rule source
  const checkResult = checkRuleSource(entrySource, {
    resolve: config.resolve,
    path: config.entry,
  });

  if (!checkResult.ok) {
    throw new Error(`Entry rule check failed:\n${checkResult.errors.join("\n")}`);
  }

  const header = checkResult.header;
  if (!header) {
    throw new Error("Entry rule missing rule header");
  }

  // Validate exactly 2 parameters
  if (header.params.length !== 2) {
    throw new Error(
      `Entry rule must have exactly 2 parameters (state, event), got ${header.params.length}`
    );
  }

  // Validate return type is Result
  if (!header.returnType || header.returnType.kind !== "TUnion" || header.returnType.name !== "Result") {
    throw new Error("Entry rule must return a Result type");
  }

  // Validate Result has state and effects fields
  const resultPayload = header.returnType.args[0];
  if (!resultPayload || resultPayload.kind !== "TRecord") {
    throw new Error("Result return type must have a record payload with state and effects fields");
  }

  if (!resultPayload.fields.has("state") || !resultPayload.fields.has("effects")) {
    throw new Error("Result record must have exactly state and effects fields");
  }

  // Parse and load the module graph to get declaration environment
  const moduleGraph = loadModules(entrySource, config.entry, config.resolve);
  const declEnv = buildGraphDeclEnv(moduleGraph);
  const prelude = createPrelude();

  // Extract the rule body expression from the parsed program
  const program = parseProgram(lex(entrySource));
  if (!program.body) {
    throw new Error("Entry rule has no body expression");
  }
  const ruleBody = program.body;

  // Store the header and initial state for dispatch
  let currentState = config.initialState;

  return {
    getState(): State {
      return currentState;
    },
    dispatch(event: Event): State {
      // Convert state and event via jsToRill against header param types
      const stateParam = header.params[0];
      const eventParam = header.params[1];

      let rillState: Value;
      let rillEvent: Value;
      try {
        rillState = jsToRill(currentState, stateParam.type, declEnv, "state");
        rillEvent = jsToRill(event, eventParam.type, declEnv, "event");
      } catch (error) {
        throw new Error(
          `Failed to bridge input values: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Evaluate the rule body with parameters bound
      let result: Value;
      try {
        // Create environment with parameters bound by name
        const env = new Map(prelude);
        env.set(stateParam.name, rillState);
        env.set(eventParam.name, rillEvent);

        // Evaluate the rule body expression
        result = evaluate(ruleBody, env);
      } catch (error) {
        throw new Error(
          `Failed to evaluate transition: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Parse the result: should be Ok or Err tag
      if (result.kind !== "Tag") {
        throw new Error(
          `Transition rule did not return a Result tag, got ${result.kind}`
        );
      }

      if (result.tag === "Err") {
        // Error case: extract message, throw TransitionError, preserve state
        const errMsg = result.args.length > 0 ? rillToJs(result.args[0]) : "unknown error";
        throw new TransitionError(String(errMsg));
      }

      if (result.tag !== "Ok") {
        throw new TransitionError(
          `Transition rule returned unexpected tag "${result.tag}", expected Ok or Err`
        );
      }

      // Ok case: extract {state, effects}, swap state, run executors
      const okPayload = result.args.length > 0 ? result.args[0] : null;
      if (!okPayload || okPayload.kind !== "Record") {
        throw new Error(
          `Transition rule returned Ok with invalid payload, expected record with state and effects`
        );
      }

      const newStateValue = okPayload.fields.get("state");
      const effectsValue = okPayload.fields.get("effects");

      if (!newStateValue || !effectsValue) {
        throw new Error(
          `Result record missing state or effects fields`
        );
      }

      // Convert new state back to JS and swap
      const newState = rillToJs(newStateValue) as State;
      currentState = newState;

      // Run executors in effect-list order
      // Effects should be a List value
      if (effectsValue.kind !== "List") {
        throw new Error(
          `Effects must be a list, got ${effectsValue.kind}`
        );
      }

      for (const effect of effectsValue.elements) {
        if (effect.kind !== "Tag") {
          throw new Error(
            `Effect must be a tag, got ${effect.kind}`
          );
        }

        const executor = config.executors[effect.tag];
        if (!executor) {
          throw new TransitionError(
            `No executor registered for effect tag "${effect.tag}"`
          );
        }

        // Get the payload (if any) and convert via rillToJs
        const payload = effect.args.length > 0 ? rillToJs(effect.args[0]) : undefined;

        // Invoke executor synchronously
        const result = executor(payload);

        // If async, handle rejection
        if (result && typeof result === "object" && "then" in result && typeof (result as any).then === "function") {
          // It's a promise - handle async executor rejection
          const promise = result as Promise<void>;
          promise.catch((err: unknown) => {
            if (config.onExecutorError) {
              config.onExecutorError(err, effect.tag);
            } else {
              // Rethrow on microtask queue
              Promise.resolve().then(() => {
                throw err;
              });
            }
          });
        }
      }

      return newState;
    },
  };
}
