import { lex } from "./lexer";
import { parseProgram } from "./parser";
import { evaluate } from "./evaluator";
import { infer, createPreludeTypeEnv, bindType } from "./typechecker";
import { prettyPrint } from "./values";
import { resetTypeVarCounter } from "./types";
import { createPrelude } from "./prelude";
import { RillError } from "./errors";

interface RunResult {
  output?: string;
  error?: string;
}

export function runSource(source: string): RunResult {
  try {
    const tokens = lex(source);
    const program = parseProgram(tokens);

    // Type check — only block on RillError (formatted type errors with source info)
    // Skip TypeError from inference limitations (missing prelude types, no sum types)
    // Files with a `rule` header are checked against the full prelude + declared params.
    resetTypeVarCounter();
    try {
      if (program.header) {
        let typeEnv = createPreludeTypeEnv();
        for (const param of program.header.params) {
          typeEnv = bindType(typeEnv, param.name, param.type);
        }
        infer(program.body, typeEnv, source);
      } else {
        infer(program.body, undefined, source);
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
