import type { ForumBoard } from "./read.server";
import { authorizeDatabase } from "@/modules/permissions/authorization.server";

export async function isForumBoardWithinPrivateTree(
  database: D1Database,
  boardId: string,
) {
  const privateAncestor = await database
    .prepare(
      "SELECT 1 AS privateAncestor FROM board_closure AS path INNER JOIN boards AS ancestor ON ancestor.id = path.ancestor_id WHERE path.descendant_id = ? AND ancestor.visibility = 'private' LIMIT 1",
    )
    .bind(boardId)
    .first<{ privateAncestor: number }>();
  return privateAncestor !== null;
}

export async function canViewForumBoard(
  database: D1Database,
  board: ForumBoard,
  userId: string | null,
) {
  if (!(await isForumBoardWithinPrivateTree(database, board.id))) return true;
  return canViewPrivateForumContent(database, board, userId);
}

export async function canViewPrivateForumContent(
  database: D1Database,
  board: ForumBoard,
  userId: string | null,
) {
  return (
    await authorizeDatabase(database, {
      userId,
      permission: "boards.view",
      boardId: board.id,
    })
  ).allowed;
}

export async function canCreateForumThread(
  database: D1Database,
  board: ForumBoard,
  userId: string | null,
) {
  if (board.mode !== "posting") return false;
  return (
    await authorizeDatabase(database, {
      userId,
      permission: "threads.create",
      boardId: board.id,
    })
  ).allowed;
}

export async function canReplyInForumBoard(
  database: D1Database,
  board: ForumBoard,
  userId: string | null,
) {
  if (board.mode !== "posting") return false;
  return (
    await authorizeDatabase(database, {
      userId,
      permission: "posts.reply",
      boardId: board.id,
    })
  ).allowed;
}
