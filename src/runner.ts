import * as fs from "node:fs";
import * as path from "node:path";
import { lex } from "./lexer";
import { parseProgram } from "./parser";
import { evaluate, evaluateProgram } from "./evaluator";
import { infer, createPreludeTypeEnv, bindType } from "./typechecker";
import { prettyPrint } from "./values";
import { resetTypeVarCounter } from "./types";
import { createPrelude } from "./prelude";
import { RillError } from "./errors";
import { buildDeclEnv, createPreludeDeclEnv, resolveTypeAnn } from "./decls";
import { Resolver, loadModules, buildGraphDeclEnv, checkModuleGraph, evaluateModuleGraph } from "./modules";

interface RunResult {
  output?: string;
  error?: string;
}

interface RunOptions {
  resolve?: Resolver;
  path?: string;
}

/**
 * Creates a filesystem resolver that resolves import paths relative to a base directory.
 * Appends .lv extension if the import path has no extension.
 * When fromPath is provided, resolves relative to that file's directory;
 * otherwise resolves relative to baseDir.
 * Maintains backward compatibility for single-arg resolvers (in-memory test resolvers).
 */
export function createFsResolver(baseDir: string): Resolver {
  return (importPath: string, fromPath?: string) => {
    // Append .lv extension if no extension present
    const fullPath = importPath.includes(".") ? importPath : `${importPath}.lv`;

    // If fromPath is provided, resolve relative to that file's directory
    // Otherwise resolve relative to baseDir
    let resolveDir = baseDir;
    if (fromPath) {
      resolveDir = path.dirname(path.resolve(baseDir, fromPath));
    }

    const resolvedPath = path.resolve(resolveDir, fullPath);
    return fs.readFileSync(resolvedPath, "utf-8");
  };
}

export function runSource(source: string, options?: RunOptions): RunResult {
  try {
    const tokens = lex(source);
    const program = parseProgram(tokens);

    // Load modules if imports are present
    let graphDeclEnv = createPreludeDeclEnv();
    let moduleExports;
    let moduleValues;

    if (program.imports.length > 0) {
      // Check if resolver is provided
      if (!options?.resolve) {
        return {
          error: "this program imports modules but no resolver was provided"
        };
      }

      // Load and check the module graph
      try {
        const entryPath = options.path || "entry";
        const moduleGraph = loadModules(source, entryPath, options.resolve);
        graphDeclEnv = buildGraphDeclEnv(moduleGraph);

        // Check only helper modules, excluding the entry module itself
        const helperGraph = {
          modules: new Map(
            [...moduleGraph.modules.entries()].filter(([path]) => path !== entryPath)
          ),
          order: moduleGraph.order.filter(path => path !== entryPath),
        };
        if (helperGraph.order.length > 0) {
          moduleExports = checkModuleGraph(helperGraph, graphDeclEnv, createPreludeTypeEnv());
          moduleValues = evaluateModuleGraph(helperGraph, createPrelude());
        }
      } catch (e: any) {
        const message = e instanceof RillError ? e.message : (e instanceof Error ? e.message : String(e));
        return { error: message };
      }
    }

    // Build the declaration environment from the file's declarations
    let declEnv;
    try {
      declEnv = buildDeclEnv(program.declarations, graphDeclEnv);
    } catch (e: any) {
      if (e instanceof RillError) {
        return { error: e.message };
      }
      throw e;
    }

    // Build import aliases map for qualified access
    const importAliasMap = new Map<string, string>();
    for (const importDecl of program.imports) {
      importAliasMap.set(importDecl.alias, importDecl.path);
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
            const resolvedType = resolveTypeAnn(param.type, declEnv, undefined, param.span, source);
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
        if (program.header.returnType && program.header.returnTypeSpan) {
          try {
            resolvedReturnType = resolveTypeAnn(program.header.returnType, declEnv, undefined, program.header.returnTypeSpan, source);
          } catch (e: any) {
            if (e instanceof RillError) {
              return { error: e.message };
            }
            throw e;
          }
        }

        infer(program.body, typeEnv, source, declEnv, importAliasMap.size > 0 ? importAliasMap : undefined, moduleExports);
      } else {
        infer(program.body, undefined, source, declEnv, importAliasMap.size > 0 ? importAliasMap : undefined, moduleExports);
      }
    } catch (e: any) {
      if (e instanceof RillError) {
        return { error: e.message };
      }
    }

    // Evaluate (header params are unbound at the CLI — the embedding host injects them)
    const env = createPrelude();

    // Add module bindings to the evaluation environment
    if (moduleValues) {
      for (const importDecl of program.imports) {
        const moduleRecord = moduleValues.get(importDecl.path);
        if (moduleRecord) {
          env.set(importDecl.alias, { kind: "Record", fields: moduleRecord });
        }
      }
    }

    const result = evaluateProgram(program, env);
    return { output: prettyPrint(result) };
  } catch (e: any) {
    return { error: e.message };
  }
}
