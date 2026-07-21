import { lex } from "./lexer";
import { parseProgram, Program } from "./parser";

export type Resolver = (path: string) => string;

export interface LoadedModule {
  path: string;
  program: Program;
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
      throw new Error(`Import cycle: ${chain.join(" -> ")}`);
    }

    // Parse the module
    const program = parseProgram(lex(source));

    // Add to import stack
    importStack.push(path);

    // Recursively load all imports
    for (const importDecl of program.imports) {
      let importedSource: string;
      try {
        importedSource = resolve(importDecl.path);
      } catch (error) {
        throw new Error(
          `Failed to resolve import "${importDecl.path}" from module "${path}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
      loadModule(importedSource, importDecl.path);
    }

    // Remove from import stack (backtrack)
    importStack.pop();

    // Add to graph in post-order (after dependencies)
    modules.set(path, { path, program });
    order.push(path);
  }

  // Load the entry module
  const entryKey = entryPath || "entry";
  loadModule(entrySource, entryKey);

  return { modules, order };
}
