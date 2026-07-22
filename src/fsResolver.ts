import * as fs from "node:fs";
import * as path from "node:path";
import { Resolver } from "./modules";

/**
 * Creates a filesystem resolver that resolves import paths relative to a base directory.
 * Appends .lv extension if the import path has no extension.
 * When fromPath is provided, resolves relative to that file's directory;
 * otherwise resolves relative to baseDir.
 * Maintains backward compatibility for single-arg resolvers (in-memory test resolvers).
 *
 * Node-only: this is the one module that touches the filesystem, kept out of
 * lib.ts so the embedding surface stays platform-neutral (bundlers resolve
 * the whole import graph eagerly and choke on node:* built-ins). Import it
 * via the "rill-lang/fs-resolver" subpath.
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
