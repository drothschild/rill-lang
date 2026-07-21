import { describe, it, expect, beforeEach } from "vitest";
import { createPrelude } from "./prelude";
import { createPreludeTypeEnv } from "./typechecker";
import { Type } from "./types";

describe("Prelude consistency", () => {
  let runtimeNames: Set<string>;
  let typeEnvNames: Set<string>;

  beforeEach(() => {
    const runtime = createPrelude();
    const typeEnv = createPreludeTypeEnv();

    runtimeNames = new Set(runtime.keys());
    typeEnvNames = new Set(typeEnv.keys());
  });

  it("runtime and type-env bind exactly the same set of builtin names", () => {
    const missingFromTypeEnv = [...runtimeNames].filter((name) => !typeEnvNames.has(name));
    const missingFromRuntime = [...typeEnvNames].filter((name) => !runtimeNames.has(name));

    if (missingFromTypeEnv.length > 0 || missingFromRuntime.length > 0) {
      const message = [
        missingFromTypeEnv.length > 0 && `Missing from type-env: ${missingFromTypeEnv.join(", ")}`,
        missingFromRuntime.length > 0 && `Missing from runtime: ${missingFromRuntime.join(", ")}`,
      ]
        .filter(Boolean)
        .join("\n");
      expect(message).toBe("");
    }
  });

  it("every runtime builtin with arity N has a type with at least N arrows", () => {
    const runtime = createPrelude();
    const typeEnv = createPreludeTypeEnv();

    const failures: string[] = [];

    for (const [name, value] of runtime) {
      if (value.kind !== "BuiltinFn") continue;
      const arity = value.arity;
      const scheme = typeEnv.get(name);
      if (!scheme) {
        failures.push(`${name}: not in type-env`);
        continue;
      }

      const arrowCount = countArrows(scheme.type);
      if (arrowCount < arity) {
        failures.push(
          `${name}: arity ${arity} but type has only ${arrowCount} arrow(s)`
        );
      }
    }

    if (failures.length > 0) {
      expect(`Arity mismatches:\n${failures.join("\n")}`).toBe("");
    }
  });
});

/**
 * Count the number of arrows in a curried function type.
 * For TFn, recursively count the arrows in the ret.
 * E.g., a -> b -> c has 2 arrows.
 */
function countArrows(t: Type): number {
  if (t.kind === "TFn") {
    return 1 + countArrows(t.ret);
  }
  return 0;
}
