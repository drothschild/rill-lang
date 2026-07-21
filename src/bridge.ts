import { Value } from "./values";

/**
 * Converts a Rill value to a JavaScript value (outbound conversion).
 * Value-directed: the conversion is determined by the runtime structure.
 *
 * Convention:
 * - Tags with no payload: { tag: "Resting" }
 * - Tags with payload: { tag: "ScheduleRest", value: {...} }
 * - Option: Some(x) → x (unwrapped), None → undefined
 * - Records → plain objects
 * - Lists → arrays
 * - Int/Float → number
 * - String/Bool/Unit → string/boolean/null
 */
export function rillToJs(value: Value): unknown {
  switch (value.kind) {
    case "Int":
    case "Float":
      return value.value;

    case "String":
      return value.value;

    case "Bool":
      return value.value;

    case "Unit":
      return null;

    case "Tag": {
      // Special handling for Option
      if (value.tag === "Some" && value.args.length === 1) {
        return rillToJs(value.args[0]);
      }
      if (value.tag === "None" && value.args.length === 0) {
        return undefined;
      }

      // General tag convention
      if (value.args.length === 0) {
        return { tag: value.tag };
      }

      if (value.args.length === 1) {
        return {
          tag: value.tag,
          value: rillToJs(value.args[0]),
        };
      }

      // Multiple args: put them all in value as an array
      return {
        tag: value.tag,
        value: value.args.map(rillToJs),
      };
    }

    case "List":
      return value.elements.map(rillToJs);

    case "Tuple":
      return value.elements.map(rillToJs);

    case "Record": {
      const result: Record<string, unknown> = {};
      for (const [key, val] of value.fields.entries()) {
        result[key] = rillToJs(val);
      }
      return result;
    }

    case "Closure":
    case "BuiltinFn":
      throw new Error(`Cannot convert ${value.kind} to JS`);
  }
}
