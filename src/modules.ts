import { lex } from "./lexer";
import { parseProgram, Program } from "./parser";
import { buildDeclEnv, createPreludeDeclEnv, DeclEnv } from "./decls";
import { RillError } from "./errors";
import { inferTopLevelLets, TypeEnv } from "./typechecker";
import { evaluateProgram } from "./evaluator";
import { Value } from "./values";

export type Resolver = (path: string, fromPath?: string) => string;

export interface LoadedModule {
  path: string;
  program: Program;
  source: string;
}

export interface ModuleGraph {
  modules: Map<string, LoadedModule>;
  order: string[];
}

/**
 * Recursively loads modules starting from an entry source.
 * Detects import cycles and caches modules to handle diamonds.
 * Returns modules in topological order (dependencies before dependents).
 *
 * @param entrySource The source code of the entry module
 * @param entryPath The path of the entry module (used as cache key)
 * @param resolve Function that resolves import paths to source code
 * @returns ModuleGraph with modules and topological order
 * @throws If a cycle is detected or resolver throws
 */
export function loadModules(
  entrySource: string,
  entryPath: string | null,
  resolve: Resolver
): ModuleGraph {
  const modules = new Map<string, LoadedModule>();
  const order: string[] = [];
  const importStack: string[] = [];

  function loadModule(source: string, path: string): void {
    // Check if already loaded (diamond handling)
    if (modules.has(path)) {
      return;
    }

    // Check for cycle
    if (importStack.includes(path)) {
      const cycleStart = importStack.indexOf(path);
      const chain = [...importStack.slice(cycleStart), path];
      throw new RillError(`Import cycle: ${chain.join(" -> ")}`, undefined);
    }

    // Parse the module
    const program = parseProgram(lex(source));

    // Add to import stack
    importStack.push(path);

    // Recursively load all imports
    for (const importDecl of program.imports) {
      let importedSource: string;
      try {
        importedSource = resolve(importDecl.path, path);
      } catch (error) {
        throw new RillError(
          `Failed to resolve import "${importDecl.path}" from module "${path}": ${error instanceof Error ? error.message : String(error)}`,
          undefined
        );
      }
      loadModule(importedSource, importDecl.path);
    }

    // Remove from import stack (backtrack)
    importStack.pop();

    // Add to graph in post-order (after dependencies)
    modules.set(path, { path, program, source });
    order.push(path);
  }

  // Load the entry module
  const entryKey = entryPath || "entry";
  loadModule(entrySource, entryKey);

  return { modules, order };
}

/**
 * Builds a merged declaration environment from all modules in the graph.
 * Processes modules in topological order, detecting cross-module collision errors.
 * Error messages name the colliding name AND both module paths.
 *
 * @param graph The module graph from loadModules
 * @returns A merged DeclEnv with all module declarations
 * @throws RillError if a duplicate type/alias/constructor is detected across modules or with prelude
 */
export function buildGraphDeclEnv(graph: ModuleGraph): DeclEnv {
  const preludeEnv = createPreludeDeclEnv();

  // Map to track which module each declaration came from (for error reporting)
  const declSources = new Map<string, string>(); // name -> modulePath

  // Add prelude declarations to the tracker
  for (const name of preludeEnv.unions.keys()) {
    declSources.set(name, "prelude");
  }
  for (const name of preludeEnv.aliases.keys()) {
    declSources.set(name, "prelude");
  }
  for (const name of preludeEnv.ctors.keys()) {
    declSources.set(name, "prelude");
  }

  // Start with prelude env
  let mergedEnv = preludeEnv;

  // Process modules in topological order
  for (const modulePath of graph.order) {
    const loadedModule = graph.modules.get(modulePath)!;
    const moduleDecls = loadedModule.program.declarations;

    // Build a module-specific env to collect its names
    const moduleEnv = buildDeclEnv(moduleDecls);

    // Try to merge with the existing environment
    // Check for collisions before actually merging
    for (const name of moduleEnv.unions.keys()) {
      if (mergedEnv.unions.has(name) || mergedEnv.aliases.has(name)) {
        const existingModule = declSources.get(name)!;
        throw new RillError(
          `Duplicate type/alias name: ${name} (declared in both "${existingModule}" and "${modulePath}")`,
          undefined
        );
      }
    }

    for (const name of moduleEnv.aliases.keys()) {
      if (mergedEnv.unions.has(name) || mergedEnv.aliases.has(name)) {
        const existingModule = declSources.get(name)!;
        throw new RillError(
          `Duplicate type/alias name: ${name} (declared in both "${existingModule}" and "${modulePath}")`,
          undefined
        );
      }
    }

    for (const name of moduleEnv.ctors.keys()) {
      if (mergedEnv.ctors.has(name)) {
        const existingModule = declSources.get(name)!;
        const existingUnion = mergedEnv.ctors.get(name)!.union;
        const newUnion = moduleEnv.ctors.get(name)!.union;
        throw new RillError(
          `Constructor ${name} defined in both ${existingUnion} (from "${existingModule}") and ${newUnion} (from "${modulePath}")`,
          undefined
        );
      }
    }

    // No collisions - perform the merge
    mergedEnv = {
      unions: new Map([...mergedEnv.unions, ...moduleEnv.unions]),
      aliases: new Map([...mergedEnv.aliases, ...moduleEnv.aliases]),
      ctors: new Map([...mergedEnv.ctors, ...moduleEnv.ctors]),
    };

    // Track the source of each declaration
    for (const name of moduleEnv.unions.keys()) {
      declSources.set(name, modulePath);
    }
    for (const name of moduleEnv.aliases.keys()) {
      declSources.set(name, modulePath);
    }
    for (const name of moduleEnv.ctors.keys()) {
      declSources.set(name, modulePath);
    }
  }

  return mergedEnv;
}

/**
 * Type-checks all modules in the graph in topological order.
 * Returns a map of module path -> (name -> scheme) for each module's top-level lets.
 * Handles qualified access to module bindings (h.func resolves via import alias table).
 *
 * @param graph The module graph from loadModules
 * @param declEnv The merged declaration environment from buildGraphDeclEnv
 * @param baseTypeEnv The prelude type environment
 * @returns Map from module path to module's let schemes
 * @throws RillError if type checking fails in any module
 */
export function checkModuleGraph(
  graph: ModuleGraph,
  declEnv: DeclEnv,
  baseTypeEnv: TypeEnv
): Map<string, TypeEnv> {
  const moduleExports = new Map<string, TypeEnv>();

  // Process modules in topological order
  for (const modulePath of graph.order) {
    const loadedModule = graph.modules.get(modulePath)!;
    const program = loadedModule.program;

    // Build import alias table for this module (alias -> modulePath)
    const importAliases = new Map<string, string>();
    for (const importDecl of program.imports) {
      importAliases.set(importDecl.alias, importDecl.path);
    }

    // Check for shadowing: local lets that shadow import aliases
    let current = program.body;
    while (current.kind === "Let") {
      if (importAliases.has(current.name)) {
        throw new RillError(
          `Local let "${current.name}" shadows import alias in module "${modulePath}"`,
          current.span,
          loadedModule.source
        );
      }
      current = current.body;
    }

    // Create type environment with prelude + this module's imports
    // Imports are bound as type variables (they're records, but we don't need their full type here)
    let moduleTypeEnv = new Map(baseTypeEnv);

    // Infer top-level lets
    try {
      const schemes = inferTopLevelLets(
        program.body,
        moduleTypeEnv,
        loadedModule.source,
        declEnv,
        importAliases,
        moduleExports
      );

      // Store this module's exports
      moduleExports.set(modulePath, schemes);
    } catch (error) {
      // Re-wrap module errors with module context, wrapping the raw message before formatting
      if (error instanceof RillError) {
        const wrappedMessage = `in module "${modulePath}": ${error.msg}`;
        throw new RillError(wrappedMessage, error.span, error.source);
      }
      throw error;
    }
  }

  return moduleExports;
}

/**
 * Evaluates all modules in the graph in topological order.
 * Each module's top-level lets evaluate once. Import aliases are bound as Record values
 * of the exporting module's bindings, enabling qualified access (h.func).
 *
 * @param graph The module graph from loadModules
 * @param baseEnv The prelude runtime environment
 * @returns Map from module path to module's evaluated value bindings
 */
export function evaluateModuleGraph(
  graph: ModuleGraph,
  baseEnv: Map<string, Value>
): Map<string, Map<string, Value>> {
  const moduleValues = new Map<string, Map<string, Value>>();

  // Process modules in topological order
  for (const modulePath of graph.order) {
    const loadedModule = graph.modules.get(modulePath)!;
    const program = loadedModule.program;

    // Build evaluation environment with prelude + imports
    let moduleEnv = new Map(baseEnv);

    // Add imports: each import alias is bound to the exporting module's record value
    for (const importDecl of program.imports) {
      const importedModuleValues = moduleValues.get(importDecl.path);
      if (importedModuleValues) {
        // Create a Record value from the module's exports
        const importedRecord: Value = {
          kind: "Record",
          fields: new Map(importedModuleValues),
        };
        moduleEnv.set(importDecl.alias, importedRecord);
      }
    }

    // Evaluate the module's body and extract top-level let bindings
    const bindings = new Map<string, Value>();
    let current = program.body;

    while (current.kind === "Let") {
      // Evaluate the let value in the current environment
      const value = evaluateProgram(
        { imports: [], declarations: [], header: null, body: current.value },
        moduleEnv
      );
      bindings.set(current.name, value);

      // Add to environment for subsequent lets
      moduleEnv.set(current.name, value);
      current = current.body;
    }

    // Also evaluate the remaining body to ensure it doesn't error
    evaluateProgram({ imports: [], declarations: [], header: null, body: current }, moduleEnv);

    // Store this module's bindings
    moduleValues.set(modulePath, bindings);
  }

  return moduleValues;
}
