import { describe, it, expect } from "vitest";
// Import from the BUILT package entry, exactly as a consumer would.
import { infer, createPreludeTypeEnv, bindType, T, lex, parse } from "../dist/lib.js";

describe("built lib.js checking API", () => {
  it("exports the checking API as callable values", () => {
    expect(typeof infer).toBe("function");
    expect(typeof createPreludeTypeEnv).toBe("function");
    expect(typeof bindType).toBe("function");
    expect(typeof T.record).toBe("function");
    expect(typeof T.list).toBe("function");
  });

  it("type-checks a trivial open-record program via the public API", () => {
    // Signature: r is an OPEN record; reading r.a (an Int field) must type-check.
    let env = createPreludeTypeEnv();
    env = bindType(env, "r", T.record({ a: T.Int }, true));
    // A program that reads a declared field off the open record.
    expect(() => infer(parse(lex("r.a")), env, "r.a")).not.toThrow();
    // Reading an undeclared field off the OPEN record also type-checks (row grows).
    expect(() => infer(parse(lex("r.b")), env, "r.b")).not.toThrow();
  });
});
