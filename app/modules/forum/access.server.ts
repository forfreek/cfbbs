import type { ForumBoard } from "./read.server";
import { authorizeDatabase } from "@/modules/permissions/authorization.server";

export async function canViewForumBoard(
  database: D1Database,
  board: ForumBoard,
  userId: string | null,
) {
  if (board.visibility === "public") return true;
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
