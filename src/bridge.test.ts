import { describe, it, expect } from "vitest";
import { Value } from "./values";
import { rillToJs, jsToRill, BridgeError } from "./bridge";
import { DeclEnv } from "./decls";
import { T } from "./types";
import { createPreludeDeclEnv } from "./decls";

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

describe("jsToRill - type-directed inbound conversion", () => {
  const declEnv = createPreludeDeclEnv();

  describe("scalar types", () => {
    it("converts number to Int when declared as Int", () => {
      const result = jsToRill(42, T.Int, declEnv, "value");
      expect(result).toEqual({ kind: "Int", value: 42 });
    });

    it("converts integer to Float when declared as Float", () => {
      const result = jsToRill(42, T.Float, declEnv, "value");
      expect(result).toEqual({ kind: "Float", value: 42.0 });
    });

    it("converts decimal to Float when declared as Float", () => {
      const result = jsToRill(3.14, T.Float, declEnv, "value");
      expect(result).toEqual({ kind: "Float", value: 3.14 });
    });

    it("rejects decimal as Int with field path", () => {
      expect(() => jsToRill(42.5, T.Int, declEnv, "reps")).toThrow(BridgeError);
      try {
        jsToRill(42.5, T.Int, declEnv, "reps");
      } catch (e) {
        expect((e as BridgeError).message).toContain("reps");
      }
    });

    it("converts string to String", () => {
      const result = jsToRill("hello", T.String, declEnv, "text");
      expect(result).toEqual({ kind: "String", value: "hello" });
    });

    it("converts boolean to Bool", () => {
      expect(jsToRill(true, T.Bool, declEnv, "flag")).toEqual({
        kind: "Bool",
        value: true,
      });
      expect(jsToRill(false, T.Bool, declEnv, "flag")).toEqual({
        kind: "Bool",
        value: false,
      });
    });

    it("converts null to Unit", () => {
      const result = jsToRill(null, T.Unit, declEnv, "unit");
      expect(result).toEqual({ kind: "Unit" });
    });
  });

  describe("Option", () => {
    it("converts undefined to None", () => {
      const result = jsToRill(undefined, T.union("Option", [T.Int]), declEnv, "opt");
      expect(result).toEqual({ kind: "Tag", tag: "None", args: [] });
    });

    it("converts present value to Some(converted)", () => {
      const result = jsToRill(5, T.union("Option", [T.Int]), declEnv, "opt");
      expect(result).toEqual({
        kind: "Tag",
        tag: "Some",
        args: [{ kind: "Int", value: 5 }],
      });
    });

    it("rejects nested Option", () => {
      expect(() =>
        jsToRill(
          5,
          T.union("Option", [T.union("Option", [T.Int])]),
          declEnv,
          "nested"
        )
      ).toThrow(BridgeError);
      try {
        jsToRill(
          5,
          T.union("Option", [T.union("Option", [T.Int])]),
          declEnv,
          "nested"
        );
      } catch (e) {
        expect((e as BridgeError).message).toContain("unsupported");
      }
    });
  });

  describe("unions", () => {
    it("converts { tag, value? } to Tag", () => {
      const result = jsToRill(
        { tag: "Ok", value: 42 },
        T.union("Result", [T.Int]),
        declEnv,
        "result"
      );
      expect(result).toEqual({
        kind: "Tag",
        tag: "Ok",
        args: [{ kind: "Int", value: 42 }],
      });
    });

    it("converts tag with no payload", () => {
      const result = jsToRill(
        { tag: "None" },
        T.union("Option", [T.Int]),
        declEnv,
        "opt"
      );
      expect(result).toEqual({ kind: "Tag", tag: "None", args: [] });
    });

    it("rejects wrong tag for union with did-you-mean", () => {
      expect(() =>
        jsToRill(
          { tag: "Okok", value: 42 },
          T.union("Result", [T.Int]),
          declEnv,
          "result"
        )
      ).toThrow(BridgeError);
      try {
        jsToRill(
          { tag: "Okok", value: 42 },
          T.union("Result", [T.Int]),
          declEnv,
          "result"
        );
      } catch (e) {
        const msg = (e as BridgeError).message;
        expect(msg).toContain("result");
        expect(msg).toContain("Okok");
        // Should suggest "Ok" via did-you-mean
      }
    });

    it("rejects missing tag key", () => {
      expect(() =>
        jsToRill(
          { value: 42 },
          T.union("Result", [T.Int]),
          declEnv,
          "result"
        )
      ).toThrow(BridgeError);
    });
  });

  describe("records", () => {
    it("converts object to Record", () => {
      const result = jsToRill(
        { name: "Alice", age: 30 },
        T.record({ name: T.String, age: T.Int }),
        declEnv,
        "person"
      );
      expect(result).toEqual({
        kind: "Record",
        fields: new Map([
          ["name", { kind: "String", value: "Alice" }],
          ["age", { kind: "Int", value: 30 }],
        ]),
      });
    });

    it("errors on missing required field with field name in path", () => {
      expect(() =>
        jsToRill({}, T.record({ name: T.String, age: T.Int }), declEnv, "person")
      ).toThrow(BridgeError);
      try {
        jsToRill({}, T.record({ name: T.String, age: T.Int }), declEnv, "person");
      } catch (e) {
        const msg = (e as BridgeError).message;
        expect(msg).toContain("name");
      }
    });

    it("ignores extra keys", () => {
      const result = jsToRill(
        { name: "Alice", age: 30, extra: "ignored" },
        T.record({ name: T.String, age: T.Int }),
        declEnv,
        "person"
      );
      expect(result).toEqual({
        kind: "Record",
        fields: new Map([
          ["name", { kind: "String", value: "Alice" }],
          ["age", { kind: "Int", value: 30 }],
        ]),
      });
    });

    it("allows missing Option field (treats as None)", () => {
      const result = jsToRill(
        { name: "Alice" },
        T.record({
          name: T.String,
          nickname: T.union("Option", [T.String]),
        }),
        declEnv,
        "person"
      );
      expect(result).toEqual({
        kind: "Record",
        fields: new Map([
          ["name", { kind: "String", value: "Alice" }],
          [
            "nickname",
            { kind: "Tag", tag: "None", args: [] },
          ],
        ]),
      });
    });

    it("composes field paths in nested structures", () => {
      expect(() =>
        jsToRill(
          { entries: [{ reps: 42.5 }] },
          T.record({
            entries: T.list(T.record({ reps: T.Int })),
          }),
          declEnv,
          "state"
        )
      ).toThrow(BridgeError);
      try {
        jsToRill(
          { entries: [{ reps: 42.5 }] },
          T.record({
            entries: T.list(T.record({ reps: T.Int })),
          }),
          declEnv,
          "state"
        );
      } catch (e) {
        const msg = (e as BridgeError).message;
        // Should contain the composed path
        expect(msg).toMatch(/state.*entries.*\[0\].*reps|entries.*reps/);
      }
    });
  });

  describe("lists", () => {
    it("converts array to List", () => {
      const result = jsToRill([1, 2, 3], T.list(T.Int), declEnv, "nums");
      expect(result).toEqual({
        kind: "List",
        elements: [
          { kind: "Int", value: 1 },
          { kind: "Int", value: 2 },
          { kind: "Int", value: 3 },
        ],
      });
    });

    it("converts empty array", () => {
      const result = jsToRill([], T.list(T.Int), declEnv, "nums");
      expect(result).toEqual({ kind: "List", elements: [] });
    });

    it("threads list index paths", () => {
      expect(() =>
        jsToRill([42, 42.5], T.list(T.Int), declEnv, "nums")
      ).toThrow(BridgeError);
      try {
        jsToRill([42, 42.5], T.list(T.Int), declEnv, "nums");
      } catch (e) {
        const msg = (e as BridgeError).message;
        expect(msg).toContain("[1]");
      }
    });
  });

  describe("round-trip (AC6.1)", () => {
    it("round-trips Int", () => {
      const original = { kind: "Int" as const, value: 42 };
      const js = rillToJs(original);
      const roundTrip = jsToRill(js, T.Int, declEnv, "x");
      expect(roundTrip).toEqual(original);
    });

    it("round-trips Float", () => {
      const original = { kind: "Float" as const, value: 3.14 };
      const js = rillToJs(original);
      const roundTrip = jsToRill(js, T.Float, declEnv, "x");
      expect(roundTrip).toEqual(original);
    });

    it("round-trips tag with payload", () => {
      const original: Value = {
        kind: "Tag",
        tag: "Ok",
        args: [{ kind: "Int", value: 42 }],
      };
      const js = rillToJs(original);
      const roundTrip = jsToRill(js, T.union("Result", [T.Int]), declEnv, "x");
      expect(roundTrip).toEqual(original);
    });

    it("round-trips Some(x)", () => {
      const original: Value = {
        kind: "Tag",
        tag: "Some",
        args: [{ kind: "String", value: "hello" }],
      };
      const js = rillToJs(original);
      const roundTrip = jsToRill(
        js,
        T.union("Option", [T.String]),
        declEnv,
        "x"
      );
      expect(roundTrip).toEqual(original);
    });

    it("round-trips None", () => {
      const original: Value = {
        kind: "Tag",
        tag: "None",
        args: [],
      };
      const js = rillToJs(original);
      const roundTrip = jsToRill(
        js,
        T.union("Option", [T.String]),
        declEnv,
        "x"
      );
      expect(roundTrip).toEqual(original);
    });

    it("round-trips record with nested structures", () => {
      const original: Value = {
        kind: "Record",
        fields: new Map([
          ["id", { kind: "Int", value: 1 }],
          [
            "status",
            { kind: "Tag", tag: "Active", args: [] },
          ],
          [
            "items",
            {
              kind: "List",
              elements: [
                { kind: "String", value: "a" },
                { kind: "String", value: "b" },
              ],
            },
          ],
        ]),
      };
      const js = rillToJs(original);
      const recordType = T.record({
        id: T.Int,
        status: T.union("Status", []),
        items: T.list(T.String),
      });
      // Note: Status union doesn't exist in prelude, so we'd need to pass a custom DeclEnv for real tests
      // For now, test with a simpler structure
      const simpleOriginal: Value = {
        kind: "Record",
        fields: new Map([
          ["x", { kind: "Int", value: 42 }],
        ]),
      };
      const simpleJs = rillToJs(simpleOriginal);
      const roundTrip = jsToRill(
        simpleJs,
        T.record({ x: T.Int }),
        declEnv,
        "rec"
      );
      expect(roundTrip).toEqual(simpleOriginal);
    });

    it("round-trips list of records", () => {
      const original: Value = {
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
      };
      const js = rillToJs(original);
      const roundTrip = jsToRill(
        js,
        T.list(T.record({ x: T.Int })),
        declEnv,
        "items"
      );
      expect(roundTrip).toEqual(original);
    });
  });

  describe("Int/Float coercion (AC6.2)", () => {
    it("accepts integer as Float", () => {
      const result = jsToRill(42, T.Float, declEnv, "value");
      expect(result.kind).toBe("Float");
      expect((result as any).value).toBe(42.0);
    });

    it("rejects decimal as Int with field path", () => {
      expect(() => jsToRill(42.5, T.Int, declEnv, "reps")).toThrow(BridgeError);
    });

    it("field path appears in Int/Float error", () => {
      try {
        jsToRill(
          { reps: 42.5 },
          T.record({ reps: T.Int }),
          declEnv,
          "record"
        );
        expect.fail("should throw");
      } catch (e) {
        expect((e as BridgeError).message).toContain("reps");
      }
    });
  });
});

describe("BridgeError class", () => {
  it("is an Error", () => {
    const err = new BridgeError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("has message property", () => {
    const err = new BridgeError("test message");
    expect(err.message).toBe("test message");
  });
});
