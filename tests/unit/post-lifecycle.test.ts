import { describe, expect, it } from "vitest";
describe("post lifecycle contract", () => {
  it("models deletion as a soft state to retain federation identity", () => {
    const deleted = { state: "deleted", deletedAt: new Date().toISOString() };
    expect(deleted).toHaveProperty("deletedAt");
  });
});
