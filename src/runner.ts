import { lex } from "./lexer";
import { parseProgram } from "./parser";
import { evaluate } from "./evaluator";
import { infer, createPreludeTypeEnv, bindType } from "./typechecker";
import { prettyPrint } from "./values";
import { resetTypeVarCounter } from "./types";
import { createPrelude } from "./prelude";
import { RillError } from "./errors";
import { buildDeclEnv, createPreludeDeclEnv, resolveTypeAnn } from "./decls";

interface RunResult {
  output?: string;
  error?: string;
}

export function runSource(source: string): RunResult {
  try {
    const tokens = lex(source);
    const program = parseProgram(tokens);

    // Build the declaration environment from the file's declarations
    let declEnv;
    try {
      declEnv = buildDeclEnv(program.declarations, createPreludeDeclEnv());
    } catch (e: any) {
      if (e instanceof RillError) {
        return { error: e.message };
      }
      throw e;
    }

    // Type check — only block on RillError (formatted type errors with source info)
    // Skip TypeError from inference limitations (missing prelude types, no sum types)
    // Files with a `rule` header are checked against the full prelude + declared params.
    resetTypeVarCounter();
    try {
      if (program.header) {
        let typeEnv = createPreludeTypeEnv();

        // Resolve and validate header parameter types
        for (const param of program.header.params) {
          try {
            const resolvedType = resolveTypeAnn(param.type, declEnv);
            typeEnv = bindType(typeEnv, param.name, resolvedType);
          } catch (e: any) {
            if (e instanceof RillError) {
              return { error: e.message };
            }
            throw e;
          }
        }

        // Resolve return type if present
        let resolvedReturnType = program.header.returnType;
        if (program.header.returnType) {
          try {
            resolvedReturnType = resolveTypeAnn(program.header.returnType, declEnv);
          } catch (e: any) {
            if (e instanceof RillError) {
              return { error: e.message };
            }
            throw e;
          }
        }

        infer(program.body, typeEnv, source, declEnv);
      } else {
        infer(program.body, undefined, source, declEnv);
      }
    } catch (e: any) {
      if (e instanceof RillError) {
        return { error: e.message };
      }
    }

    // Evaluate (header params are unbound at the CLI — the embedding host injects them)
    const env = createPrelude();
    const result = evaluate(program.body, env);
    return { output: prettyPrint(result) };
  } catch (e: any) {
    return { error: e.message };
  }
}
