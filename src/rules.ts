import { lex } from "./lexer";
import { parseProgram, RuleHeader } from "./parser";
import { infer, createPreludeTypeEnv, bindType } from "./typechecker";
import { unify } from "./unify";
import { prettyType, resetTypeVarCounter } from "./types";

export interface RuleCheckResult {
  ok: boolean;
  errors: string[];
  header: RuleHeader | null;
}

// Load-time check for a self-describing rule file: parse the `rule` header,
// bind its declared params over the prelude type env, infer the body, and
// unify the inferred type with the declared return type (when present).
// Never throws — parse and type errors are collected into `errors`.
export function checkRuleSource(source: string): RuleCheckResult {
  let header: RuleHeader | null = null;
  try {
    resetTypeVarCounter();
    const program = parseProgram(lex(source));
    header = program.header;
    if (!header) {
      return {
        ok: false,
        errors: ["missing rule header: expected `rule name(param: Type, ...) -> Type` before the body"],
        header: null,
      };
    }
    let env = createPreludeTypeEnv();
    for (const param of header.params) {
      env = bindType(env, param.name, param.type);
    }
    const inferred = infer(program.body, env, source);
    if (header.returnType) {
      try {
        unify(inferred, header.returnType);
      } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          errors: [
            `rule '${header.name}' declares return type ${prettyType(header.returnType)} but its body has type ${prettyType(inferred)} (${detail})`,
          ],
          header,
        };
      }
    }
    return { ok: true, errors: [], header };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [message], header };
  }
}
