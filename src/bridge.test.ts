import { describe, it, expect } from "vitest";
import { Value } from "./values";
import { rillToJs } from "./bridge";

describe("rillToJs - value-directed outbound conversion", () => {
  describe("scalar types", () => {
    it("converts Int to number", () => {
      const result = rillToJs({ kind: "Int", value: 42 });
      expect(result).toBe(42);
    });

    it("converts Float to number", () => {
      const result = rillToJs({ kind: "Float", value: 3.14 });
      expect(result).toBe(3.14);
    });

    it("converts String to string", () => {
      const result = rillToJs({ kind: "String", value: "hello" });
      expect(result).toBe("hello");
    });

    it("converts Bool to boolean", () => {
      expect(rillToJs({ kind: "Bool", value: true })).toBe(true);
      expect(rillToJs({ kind: "Bool", value: false })).toBe(false);
    });

    it("converts Unit to null", () => {
      const result = rillToJs({ kind: "Unit" });
      expect(result).toBe(null);
    });
  });

  describe("tags", () => {
    it("converts tag with no payload to { tag: string }", () => {
      const result = rillToJs({ kind: "Tag", tag: "Resting", args: [] });
      expect(result).toEqual({ tag: "Resting" });
    });

    it("converts tag with single payload to { tag, value }", () => {
      const result = rillToJs({
        kind: "Tag",
        tag: "ScheduleRest",
        args: [{ kind: "Int", value: 123 }],
      });
      expect(result).toEqual({ tag: "ScheduleRest", value: 123 });
    });

    it("converts tag with object payload", () => {
      const result = rillToJs({
        kind: "Tag",
        tag: "Event",
        args: [
          {
            kind: "Record",
            fields: new Map([["ms", { kind: "Int", value: 100 }]]),
          },
        ],
      });
      expect(result).toEqual({ tag: "Event", value: { ms: 100 } });
    });
  });

  describe("Option", () => {
    it("converts Some(x) to unwrapped x", () => {
      const result = rillToJs({
        kind: "Tag",
        tag: "Some",
        args: [{ kind: "Int", value: 5 }],
      });
      expect(result).toBe(5);
    });

    it("converts None to undefined", () => {
      const result = rillToJs({
        kind: "Tag",
        tag: "None",
        args: [],
      });
      expect(result).toBeUndefined();
    });
  });

  describe("lists", () => {
    it("converts List to array", () => {
      const result = rillToJs({
        kind: "List",
        elements: [
          { kind: "Int", value: 1 },
          { kind: "Int", value: 2 },
          { kind: "Int", value: 3 },
        ],
      });
      expect(result).toEqual([1, 2, 3]);
    });

    it("converts empty list to empty array", () => {
      const result = rillToJs({ kind: "List", elements: [] });
      expect(result).toEqual([]);
    });

    it("converts list of tags", () => {
      const result = rillToJs({
        kind: "List",
        elements: [
          { kind: "Tag", tag: "Ping", args: [] },
          { kind: "Tag", tag: "Pong", args: [] },
        ],
      });
      expect(result).toEqual([{ tag: "Ping" }, { tag: "Pong" }]);
    });
  });

  describe("records", () => {
    it("converts Record to plain object", () => {
      const result = rillToJs({
        kind: "Record",
        fields: new Map([
          ["name", { kind: "String", value: "Alice" }],
          ["age", { kind: "Int", value: 30 }],
        ]),
      });
      expect(result).toEqual({ name: "Alice", age: 30 });
    });

    it("converts Record with nested structures", () => {
      const result = rillToJs({
        kind: "Record",
        fields: new Map([
          ["items", { kind: "List", elements: [{ kind: "Int", value: 1 }] }],
          [
            "tag",
            { kind: "Tag", tag: "Active", args: [] },
          ],
        ]),
      });
      expect(result).toEqual({ items: [1], tag: { tag: "Active" } });
    });

    it("converts Record with None field to property with undefined value", () => {
      const result = rillToJs({
        kind: "Record",
        fields: new Map([
          ["id", { kind: "Int", value: 1 }],
          ["description", { kind: "Tag", tag: "None", args: [] }],
        ]),
      });
      expect(result).toEqual({ id: 1, description: undefined });
    });
  });

  describe("complex nested structures", () => {
    it("converts list of records", () => {
      const result = rillToJs({
        kind: "List",
        elements: [
          {
            kind: "Record",
            fields: new Map([["x", { kind: "Int", value: 1 }]]),
          },
          {
            kind: "Record",
            fields: new Map([["x", { kind: "Int", value: 2 }]]),
          },
        ],
      });
      expect(result).toEqual([{ x: 1 }, { x: 2 }]);
    });

    it("converts record containing list of tags", () => {
      const result = rillToJs({
        kind: "Record",
        fields: new Map([
          [
            "effects",
            {
              kind: "List",
              elements: [
                { kind: "Tag", tag: "Log", args: [] },
                {
                  kind: "Tag",
                  tag: "Save",
                  args: [{ kind: "String", value: "data" }],
                },
              ],
            },
          ],
        ]),
      });
      expect(result).toEqual({
        effects: [{ tag: "Log" }, { tag: "Save", value: "data" }],
      });
    });
  });

  describe("tuples (converted as arrays)", () => {
    it("converts Tuple to array", () => {
      const result = rillToJs({
        kind: "Tuple",
        elements: [
          { kind: "String", value: "a" },
          { kind: "Int", value: 1 },
        ],
      });
      expect(result).toEqual(["a", 1]);
    });
  });
});
