import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * lib.ts is the public embedding surface, and embedders bundle it for
 * non-Node runtimes (React Native/Metro, browsers). Node built-ins anywhere
 * in lib's transitive import graph break those bundlers even when the
 * importing code is never called, because bundlers resolve the whole graph
 * eagerly. This test walks the relative-import graph from lib.ts and fails
 * if any module in it imports a Node built-in.
 */
describe("lib entry platform-neutrality", () => {
  it("does not transitively import Node built-ins from lib.ts", () => {
    const srcDir = __dirname;
    const nodeBuiltinPattern = /^node:|^(fs|path|os|child_process|readline|url|util|crypto)$/;
    // Matches: import ... from "x"; export ... from "x"; import "x"
    const specifierPattern = /(?:import|export)\s+(?:[\s\S]*?from\s+)?["']([^"']+)["']/g;

    const visited = new Set<string>();
    const queue = ["lib"];
    const offenders: string[] = [];

    while (queue.length > 0) {
      const mod = queue.pop()!;
      if (visited.has(mod)) continue;
      visited.add(mod);

      const filePath = path.join(srcDir, `${mod}.ts`);
      const source = fs.readFileSync(filePath, "utf-8");

      for (const match of source.matchAll(specifierPattern)) {
        const specifier = match[1];
        if (nodeBuiltinPattern.test(specifier)) {
          offenders.push(`${mod}.ts imports "${specifier}"`);
        } else if (specifier.startsWith("./")) {
          queue.push(specifier.slice(2));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
