import { lex } from "./lexer";
import { parseProgram, RuleHeader } from "./parser";
import { infer, createPreludeTypeEnv, bindType } from "./typechecker";
import { unify } from "./unify";
import { prettyType, resetTypeVarCounter } from "./types";
import { buildDeclEnv, createPreludeDeclEnv, resolveTypeAnn } from "./decls";
import { RillError } from "./errors";
import { Resolver, loadModules, buildGraphDeclEnv, checkModuleGraph } from "./modules";

export interface RuleCheckResult {
  ok: boolean;
  errors: string[];
  header: RuleHeader | null;
}

export interface CheckRuleOptions {
  resolve?: Resolver;
  path?: string;
}

// Load-time check for a self-describing rule file: parse the `rule` header,
// build a declaration environment from the file's declarations, bind its declared
// params over the prelude type env, infer the body, and unify the inferred type
// with the declared return type (when present).
// Never throws — parse and type errors are collected into `errors`.
// Supports optional module loading via a resolver.
export function checkRuleSource(source: string, options?: CheckRuleOptions): RuleCheckResult {
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

    // Load modules if imports are present
    let declEnv;
    let graphDeclEnv = createPreludeDeclEnv();
    let moduleExports;

    if (program.imports.length > 0) {
      // Check if resolver is provided
      if (!options?.resolve) {
        return {
          ok: false,
          errors: ["this rule imports modules but no resolver was provided"],
          header,
        };
      }

      // Load and check the module graph
      try {
        const entryPath = options.path || "entry";
        const moduleGraph = loadModules(source, entryPath, options.resolve);
        graphDeclEnv = buildGraphDeclEnv(moduleGraph);

        // Check only helper modules, excluding the entry module itself
        // (entry is a rule module, helpers are utility modules with let bindings)
        const helperGraph: typeof moduleGraph = {
          modules: new Map(
            [...moduleGraph.modules.entries()].filter(([path]) => path !== entryPath)
          ),
          order: moduleGraph.order.filter(path => path !== entryPath),
        };
        if (helperGraph.order.length > 0) {
          moduleExports = checkModuleGraph(helperGraph, graphDeclEnv, createPreludeTypeEnv());
        }
      } catch (e: unknown) {
        const message = e instanceof RillError ? e.message : (e instanceof Error ? e.message : String(e));
        return { ok: false, errors: [message], header };
      }
      // When imports are present, entry's declarations are already in graphDeclEnv
      // (via loadModules/buildGraphDeclEnv), so use graphDeclEnv directly
      declEnv = graphDeclEnv;
    } else {
      // No imports: build declaration environment from this file's declarations
      try {
        declEnv = buildDeclEnv(program.declarations, graphDeclEnv);
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
    }

    // Use declaration environment for resolving header types
    const fullDeclEnv = declEnv || graphDeclEnv;

    // Build import aliases map for qualified access
    const importAliasMap = new Map<string, string>();
    for (const importDecl of program.imports) {
      importAliasMap.set(importDecl.alias, importDecl.path);
    }

    // Resolve and validate header parameter types
    const resolvedParams = [];
    for (const param of header.params) {
      try {
        const resolvedType = resolveTypeAnn(param.type, fullDeclEnv, undefined, param.span, source);
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
        resolvedReturnType = resolveTypeAnn(header.returnType, fullDeclEnv, undefined, header.returnTypeSpan, source);
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

    // Infer the body with the full declaration environment and module info
    const inferred = infer(
      program.body,
      env,
      source,
      fullDeclEnv,
      importAliasMap.size > 0 ? importAliasMap : undefined,
      moduleExports
    );

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
