import { Value } from "./values";
import { Type } from "./types";
import { DeclEnv, resolveTypeAnn, suggestName } from "./decls";
import { RillError } from "./errors";

/**
 * Bridge error for inbound conversion failures with field-path threading.
 */
export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeError";
  }
}

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

      // Multiple args are not supported at the bridge
      throw new Error(
        `Multi-payload constructors are unsupported at the bridge. Constructor "${value.tag}" has ${value.args.length} arguments.`
      );
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

/**
 * Converts a JavaScript value to a Rill value (inbound conversion).
 * TYPE-directed: the conversion is determined by the declared type.
 *
 * Threads field paths through nested conversions for error messages.
 * Key rules:
 * - Int: rejects decimals with field path in error
 * - Float: accepts integers, converts to float
 * - Option: undefined/absent → None, present → Some(converted); nested Option unsupported
 * - Union: expects { tag, value? } with tag validation + did-you-mean
 * - Record: missing non-Option fields error; extra keys ignored
 * - List: elementwise conversion with [i] paths
 * - Aliases: resolved first
 */
export function jsToRill(
  value: unknown,
  declaredType: Type,
  declEnv: DeclEnv,
  fieldPath: string
): Value {
  // Resolve aliases first
  const resolvedType = resolveTypeAnn(declaredType, declEnv);
  return jsToRillWithResolved(value, resolvedType, declEnv, fieldPath);
}

function jsToRillWithResolved(
  value: unknown,
  declaredType: Type,
  declEnv: DeclEnv,
  fieldPath: string
): Value {
  switch (declaredType.kind) {
    case "TCon": {
      if (declaredType.name === "Int") {
        if (typeof value !== "number") {
          throw new BridgeError(
            `Expected number at ${fieldPath}, got ${typeof value}`
          );
        }
        if (!Number.isInteger(value)) {
          throw new BridgeError(
            `Expected integer at ${fieldPath}, got ${value}`
          );
        }
        return { kind: "Int", value: value as number };
      }

      if (declaredType.name === "Float") {
        if (typeof value !== "number") {
          throw new BridgeError(
            `Expected number at ${fieldPath}, got ${typeof value}`
          );
        }
        return { kind: "Float", value: value as number };
      }

      if (declaredType.name === "String") {
        if (typeof value !== "string") {
          throw new BridgeError(
            `Expected string at ${fieldPath}, got ${typeof value}`
          );
        }
        return { kind: "String", value };
      }

      if (declaredType.name === "Bool") {
        if (typeof value !== "boolean") {
          throw new BridgeError(
            `Expected boolean at ${fieldPath}, got ${typeof value}`
          );
        }
        return { kind: "Bool", value };
      }

      if (declaredType.name === "Unit") {
        if (value !== null && value !== undefined) {
          throw new BridgeError(
            `Expected null for Unit at ${fieldPath}, got ${typeof value}`
          );
        }
        return { kind: "Unit" };
      }

      throw new BridgeError(`Unknown TCon type: ${declaredType.name}`);
    }

    case "TUnion": {
      // Check if value is already in union format (has "tag" key)
      const isUnionFormatted =
        typeof value === "object" &&
        value !== null &&
        "tag" in value &&
        typeof (value as any).tag === "string";

      // Special handling for Option type (before checking union format)
      if (declaredType.name === "Option" && declaredType.args.length === 1) {
        // Check for nested Option
        const innerType = declaredType.args[0];
        if (
          innerType.kind === "TUnion" &&
          innerType.name === "Option"
        ) {
          throw new BridgeError(
            `Nested Option at ${fieldPath} is unsupported at the bridge`
          );
        }

        // For Option, decide the branch based on the value:
        // - Explicit undefined/null → None
        // - Union-formatted {tag: "None"} → None (already in union representation)
        // - Union-formatted {tag: "Some", value: x} → Some(x) (already in union representation)
        // - Union-formatted {tag: <other>, ...} → Some(converted value) for union inner types
        // - Any other present value → Some(converted value)

        if (value === undefined || value === null) {
          return { kind: "Tag", tag: "None", args: [] };
        }

        // If the value is already union-formatted, check if it's an Option tag
        if (isUnionFormatted) {
          const tag = (value as any).tag;
          if (tag === "None") {
            // Explicitly formatted None - return it as-is
            return { kind: "Tag", tag: "None", args: [] };
          } else if (tag === "Some") {
            // Explicitly formatted Some - convert the payload against the inner type
            const rawPayload = (value as any).value;
            const payloadValue = jsToRillWithResolved(
              rawPayload,
              innerType,
              declEnv,
              fieldPath
            );
            return { kind: "Tag", tag: "Some", args: [payloadValue] };
          } else {
            // It's a union-formatted non-Option tag (like {tag: "Active"})
            // Treat this as Some(converted value)
            const innerValue = jsToRillWithResolved(
              value,
              innerType,
              declEnv,
              fieldPath
            );
            return { kind: "Tag", tag: "Some", args: [innerValue] };
          }
        }

        // Not union-formatted or not present: convert against inner type and wrap in Some
        const innerValue = jsToRillWithResolved(
          value,
          innerType,
          declEnv,
          fieldPath
        );
        return { kind: "Tag", tag: "Some", args: [innerValue] };
      }

      // General union handling (non-Option unions or explicitly-formatted Option tags)
      if (typeof value !== "object" || value === null) {
        throw new BridgeError(
          `Expected object with tag at ${fieldPath}, got ${typeof value}`
        );
      }

      if (!("tag" in value)) {
        throw new BridgeError(`Missing tag field at ${fieldPath}`);
      }

      const tag = (value as any).tag;
      if (typeof tag !== "string") {
        throw new BridgeError(
          `Tag must be string at ${fieldPath}, got ${typeof tag}`
        );
      }

      // Validate tag is a constructor of this union
      const unionInfo = declEnv.unions.get(declaredType.name);
      if (!unionInfo) {
        throw new BridgeError(`Unknown union ${declaredType.name}`);
      }

      if (!unionInfo.ctors.includes(tag)) {
        const suggestion = suggestName(tag, unionInfo.ctors);
        const suggestionText = suggestion ? ` (did you mean ${suggestion}?)` : "";
        throw new BridgeError(
          `Unknown constructor ${tag} for union ${declaredType.name}${suggestionText} at ${fieldPath}`
        );
      }

      // Get constructor info and instantiate with the union's type args
      const ctorInfo = declEnv.ctors.get(tag)!;
      const payloadType = ctorInfo.payload;

      // If the union has type arguments, substitute them positionally into the payload
      let instantiatedPayloadType = payloadType;
      if (declaredType.args.length > 0 && payloadType) {
        // Positional substitution: replace type params with union args
        const paramSubst = new Map<string, Type>();
        for (let i = 0; i < ctorInfo.typeParams.length && i < declaredType.args.length; i++) {
          paramSubst.set(ctorInfo.typeParams[i], declaredType.args[i]);
        }
        instantiatedPayloadType = substituteTypeParams(payloadType, paramSubst);
      }

      // Convert payload if present
      if (instantiatedPayloadType) {
        const rawPayload = (value as any).value;
        const payloadValue = jsToRillWithResolved(
          rawPayload,
          instantiatedPayloadType,
          declEnv,
          fieldPath
        );
        return { kind: "Tag", tag, args: [payloadValue] };
      } else {
        // No payload expected
        return { kind: "Tag", tag, args: [] };
      }
    }

    case "TRecord": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new BridgeError(
          `Expected object at ${fieldPath}, got ${typeof value}`
        );
      }

      const result = new Map<string, Value>();
      const obj = value as Record<string, unknown>;

      for (const [fieldName, fieldType] of declaredType.fields.entries()) {
        const fieldValue = obj[fieldName];
        const newPath = `${fieldPath}.${fieldName}`;

        // Check if field is Option type
        const isOptionField =
          fieldType.kind === "TUnion" &&
          fieldType.name === "Option" &&
          fieldType.args.length === 1;

        if (fieldValue === undefined) {
          if (isOptionField) {
            // Missing Option field → None
            result.set(
              fieldName,
              { kind: "Tag", tag: "None", args: [] }
            );
          } else {
            throw new BridgeError(
              `Missing required field ${fieldName} at ${fieldPath}`
            );
          }
        } else {
          result.set(
            fieldName,
            jsToRillWithResolved(fieldValue, fieldType, declEnv, newPath)
          );
        }
      }

      return { kind: "Record", fields: result };
    }

    case "TList": {
      if (!Array.isArray(value)) {
        throw new BridgeError(
          `Expected array at ${fieldPath}, got ${typeof value}`
        );
      }

      const elements: Value[] = [];
      for (let i = 0; i < value.length; i++) {
        const newPath = `${fieldPath}[${i}]`;
        elements.push(
          jsToRillWithResolved(value[i], declaredType.element, declEnv, newPath)
        );
      }

      return { kind: "List", elements };
    }

    case "TTuple": {
      if (!Array.isArray(value)) {
        throw new BridgeError(
          `Expected array at ${fieldPath}, got ${typeof value}`
        );
      }

      const elements: Value[] = [];
      for (let i = 0; i < declaredType.elements.length; i++) {
        const newPath = `${fieldPath}[${i}]`;
        elements.push(
          jsToRillWithResolved(
            value[i],
            declaredType.elements[i],
            declEnv,
            newPath
          )
        );
      }

      return { kind: "Tuple", elements };
    }

    case "TVar":
      throw new BridgeError(
        `Type variable ${(declaredType as any).id} at boundary: should be fully concrete`
      );

    case "TParam":
      throw new BridgeError(
        `Type parameter at boundary should have been resolved`
      );

    case "TFn":
      throw new BridgeError(`Cannot convert function type at ${fieldPath}`);
  }
}

/**
 * Positional type parameter substitution for union constructor payloads.
 * Replaces TParam nodes with their substituted types.
 */
function substituteTypeParams(t: Type, subst: Map<string, Type>): Type {
  switch (t.kind) {
    case "TParam":
      return subst.has(t.name) ? subst.get(t.name)! : t;
    case "TRecord":
      return {
        kind: "TRecord",
        fields: new Map(
          [...t.fields.entries()].map(([k, v]) => [
            k,
            substituteTypeParams(v, subst),
          ])
        ),
        rest: t.rest ? substituteTypeParams(t.rest, subst) : null,
      };
    case "TList":
      return {
        kind: "TList",
        element: substituteTypeParams(t.element, subst),
      };
    case "TTuple":
      return {
        kind: "TTuple",
        elements: t.elements.map((el) => substituteTypeParams(el, subst)),
      };
    case "TUnion":
      return {
        kind: "TUnion",
        name: t.name,
        args: t.args.map((arg) => substituteTypeParams(arg, subst)),
      };
    case "TFn":
      return {
        kind: "TFn",
        param: substituteTypeParams(t.param, subst),
        ret: substituteTypeParams(t.ret, subst),
      };
    case "TCon":
    case "TVar":
      return t;
  }
}
