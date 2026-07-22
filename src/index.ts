#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { ReplSession } from "./repl";
import { runSource } from "./runner";
import { createFsResolver } from "./fsResolver";

const args = process.argv.slice(2);

if (args[0] === "run" && args[1]) {
  // File runner mode
  const filePath = args[1];
  try {
    const source = fs.readFileSync(filePath, "utf-8");
    const fileDir = path.dirname(path.resolve(filePath));
    const resolver = createFsResolver(fileDir);
    const result = runSource(source, {
      resolve: resolver,
      path: filePath,
    });
    if (result.error) {
      console.error(result.error);
      process.exit(1);
    }
    if (result.output !== undefined) {
      console.log(result.output);
    }
  } catch (e: any) {
    console.error(`Error reading file: ${e.message}`);
    process.exit(1);
  }
} else if (args.length === 0) {
  // REPL mode
  const session = new ReplSession();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Rill v0.1.0");
  console.log('Type :quit to exit, :type <name> for types, :env to see bindings\n');

  function prompt() {
    rl.question("rill> ", (input) => {
      const trimmed = input.trim();
      if (!trimmed) return prompt();
      if (trimmed === ":quit" || trimmed === ":q") {
        console.log("Goodbye!");
        rl.close();
        return;
      }

      const result = session.eval(trimmed);
      if (result.error) {
        console.error(result.error);
      } else if (result.output !== undefined) {
        console.log(result.output);
      }
      prompt();
    });
  }

  prompt();
} else {
  console.error("Usage: rill [run <file>]");
  process.exit(1);
}
