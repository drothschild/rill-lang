import { lex } from "./lexer";
import { parseProgram, RuleHeader } from "./parser";
import { infer, createPreludeTypeEnv, bindType } from "./typechecker";
import { unify } from "./unify";
import { prettyType, resetTypeVarCounter } from "./types";
import { buildDeclEnv, createPreludeDeclEnv, resolveTypeAnn } from "./decls";
import { RillError } from "./errors";

export interface RuleCheckResult {
  ok: boolean;
  errors: string[];
  header: RuleHeader | null;
}

// Load-time check for a self-describing rule file: parse the `rule` header,
// build a declaration environment from the file's declarations, bind its declared
// params over the prelude type env, infer the body, and unify the inferred type
// with the declared return type (when present).
// Never throws — parse and type errors are collected into `errors`.
export function checkRuleSource(source: string): RuleCheckResult {
  let header: RuleHeader | null = null;
  const errors: string[] = [];
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

    // Build the declaration environment from the file's declarations
    let declEnv;
    try {
      declEnv = buildDeclEnv(program.declarations, createPreludeDeclEnv());
    } catch (e: unknown) {
      if (e instanceof RillError) {
        errors.push(e.message);
      } else {
        errors.push(e instanceof Error ? e.message : String(e));
      }
      if (errors.length > 0) {
        return { ok: false, errors, header };
      }
    }

    // Resolve and validate header parameter types
    const resolvedParams = [];
    for (const param of header.params) {
      try {
        const resolvedType = resolveTypeAnn(param.type, declEnv!, undefined, param.span, source);
        resolvedParams.push({ ...param, type: resolvedType });
      } catch (e: unknown) {
        if (e instanceof RillError) {
          errors.push(e.message);
        } else {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
    }

    // Resolve and validate return type
    let resolvedReturnType = header.returnType;
    if (header.returnType && header.returnTypeSpan) {
      try {
        resolvedReturnType = resolveTypeAnn(header.returnType, declEnv!, undefined, header.returnTypeSpan, source);
      } catch (e: unknown) {
        if (e instanceof RillError) {
          errors.push(e.message);
        } else {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
    }

    if (errors.length > 0) {
      return { ok: false, errors, header };
    }

    // Bind header parameters to the type environment
    let env = createPreludeTypeEnv();
    for (const param of resolvedParams) {
      env = bindType(env, param.name, param.type);
    }

    // Infer the body with the declaration environment
    const inferred = infer(program.body, env, source, declEnv);

    if (resolvedReturnType) {
      try {
        unify(inferred, resolvedReturnType);
      } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          errors: [
            `rule '${header.name}' declares return type ${prettyType(resolvedReturnType)} but its body has type ${prettyType(inferred)} (${detail})`,
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
