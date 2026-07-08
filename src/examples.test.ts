import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { runSource } from "./runner";

// Characterization tests: each example must keep producing exactly this output.
const EXPECTED: Record<string, string[]> = {
  "calc": [
    "=== Expression Evaluator ===",
    "",
    "2 + 3 = 5",
    "(2 + 3) * -(4) = -20",
    "10 / 0 = Error: division by zero",
    "10 / 3 = 3",
    "unknown = Error: unknown expression",
    "=== Done! ===",
    "()"
  ],
  "markdown": [
    "=== Markdown Renderer ===",
    "# My Document",
    "A quick demo with **bold** and *italic* text.",
    "## Features",
    "- Tagged values as AST",
    "- Recursive rendering",
    "- Pattern matching",
    "## Steps",
    "1. Parse",
    "2. Render",
    "3. Print",
    "Error: unrecognized node",
    "=== Done! ===",
    "()"
  ],
  "state_machine": [
    "=== Turnstile State Machine ===",
    "Start: Locked",
    "Coin inserted: unlocked!",
    "Pushed through: locked!",
    "Pushed: still locked.",
    "Coin inserted: unlocked!",
    "Extra coin: already unlocked.",
    "Pushed through: locked!",
    "Final state: Locked",
    "=== Done! ===",
    "()"
  ],
  "todo": [
    "=== Rill Todo App ===",
    "",
    "All todos:",
    "[x] Learn Rill",
    "[ ] Write a demo",
    "[ ] Share with friends",
    "[ ] Build something cool",
    "",
    "Done: 1 | Pending: 3",
    "",
    "Pending items:",
    "[ ] Write a demo",
    "[ ] Share with friends",
    "[ ] Build something cool",
    "",
    "Next up:",
    "  [ ] Write a demo",
    "",
    "After completing 'Write a demo':",
    "[x] Learn Rill",
    "[x] Write a demo",
    "[ ] Share with friends",
    "[ ] Build something cool",
    "",
    "Done: 2 | Pending: 2",
    "",
    "Summary: [x] Learn Rill | [x] Write a demo | [ ] Share with friends | [ ] Build something cool | ",
    "=== Done! ===",
    "()"
  ]
};

const EXAMPLES_DIR = path.join(__dirname, "..", "examples");

describe("examples", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name}.lv runs and prints its expected output`, () => {
      const printed: string[] = [];
      vi.spyOn(console, "log").mockImplementation((line: unknown) => {
        printed.push(String(line));
      });
      const source = readFileSync(path.join(EXAMPLES_DIR, `${name}.lv`), "utf-8");
      const result = runSource(source);
      expect(result.error).toBeUndefined();
      // The final expression's pretty-printed value is the last expected line
      expect([...printed, result.output]).toEqual(expected);
    });
  }
});
