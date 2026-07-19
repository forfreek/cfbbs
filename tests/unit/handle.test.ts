import { describe, expect, it } from "vitest";

import { normalizeHandle, validateHandle } from "@/modules/identity/handle";

describe("federation handles", () => {
  it("normalizes accepted handles to lowercase", () => {
    expect(normalizeHandle("Alice_42")).toBe("alice_42");
  });

  it("accepts a 3 to 32 character lowercase alphanumeric handle", () => {
    expect(validateHandle("alice_42")).toEqual({ ok: true, value: "alice_42" });
  });

  it.each([
    "ab",
    "a".repeat(33),
    "alice-name",
    "alice.name",
    "admin",
    "health",
  ])("rejects reserved or invalid handle %s", (handle) => {
    expect(validateHandle(handle)).toEqual({ ok: false });
  });
});
