import { describe, expect, it } from "vitest";
import { createBoardClosureStatements } from "@/modules/forum/boards/closure";
describe("board closure inserts", () => {
  it("creates a self path for a root board", () =>
    expect(createBoardClosureStatements("root", null)).toHaveLength(1));
  it("copies every parent ancestor for a child", () => {
    const statements = createBoardClosureStatements("child", "parent");
    expect(statements).toHaveLength(2);
    expect(statements[1].params).toEqual(["child", "parent"]);
  });
});
