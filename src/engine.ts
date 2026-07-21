import { Resolver, checkRuleSource } from "./rules";
import { RuleHeader } from "./parser";

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

  // Store the header and initial state for dispatch
  let currentState = config.initialState;

  return {
    getState(): State {
      return currentState;
    },
    dispatch(event: Event): State {
      // TODO: Task 5 - implement dispatch logic
      throw new Error("dispatch not yet implemented");
    },
  };
}
