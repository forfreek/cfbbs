import { describe, expect, it } from "vitest";
import { assertMoveBoard, canMoveBoard } from "@/modules/forum/boards/tree";

describe("board moves", () => {
  it("allows moving a subtree under an unrelated board or root", () => {
    expect(canMoveBoard("a", "other", ["a", "child"])).toBe(true);
    expect(canMoveBoard("a", null, ["a", "child"])).toBe(true);
  });
  it("rejects cycles", () => {
    expect(canMoveBoard("a", "a", ["a", "child"])).toBe(false);
    expect(() => assertMoveBoard("a", "child", ["a", "child"])).toThrow(
      "cannot be moved",
    );
  });
});
