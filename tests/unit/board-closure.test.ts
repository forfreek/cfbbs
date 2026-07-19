import { describe, expect, it } from "vitest";
import {
  createBoardClosureStatements,
  moveBoardClosureStatements,
} from "@/modules/forum/boards/closure";
describe("board closure inserts", () => {
  it("creates a self path for a root board", () =>
    expect(createBoardClosureStatements("root", null)).toHaveLength(1));
  it("copies every parent ancestor for a child", () => {
    const statements = createBoardClosureStatements("child", "parent");
    expect(statements).toHaveLength(2);
    expect(statements[1].params).toEqual(["child", "parent"]);
  });
});

describe("board closure moves", () => {
  it("removes only external ancestor paths before moving to the root", () => {
    const statements = moveBoardClosureStatements("child", null);

    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain("ancestor_id NOT IN");
    expect(statements[0].params).toEqual(["child", "child"]);
  });

  it("rebuilds ancestor paths from the new parent to every descendant", () => {
    const statements = moveBoardClosureStatements("child", "new-parent");

    expect(statements).toHaveLength(2);
    expect(statements[1].sql).toContain("CROSS JOIN board_closure AS subtree");
    expect(statements[1].params).toEqual(["new-parent", "child"]);
  });
});
