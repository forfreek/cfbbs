import { createBoardClosureStatements } from "./closure";

export type NewBoard = {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  description?: string;
  mode: "container" | "posting" | "read_only";
  visibility: "public" | "private";
  sortOrder?: number;
};

export async function createBoard(database: D1Database, board: NewBoard) {
  const now = new Date().toISOString();
  const statements = [
    database
      .prepare(
        "INSERT INTO boards (id, parent_id, slug, title, description, mode, visibility, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        board.id,
        board.parentId,
        board.slug,
        board.title,
        board.description ?? "",
        board.mode,
        board.visibility,
        board.sortOrder ?? 0,
        now,
        now,
      ),
    ...createBoardClosureStatements(board.id, board.parentId).map((item) =>
      database.prepare(item.sql).bind(...item.params),
    ),
  ];
  await database.batch(statements);
}
