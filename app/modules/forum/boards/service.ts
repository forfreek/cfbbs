import {
  createBoardClosureStatements,
  moveBoardClosureStatements,
} from "./closure";
import { assertMoveBoard } from "./tree";

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

export type ManagedBoard = Required<NewBoard>;

const boardModes = ["container", "posting", "read_only"] as const;
const boardVisibilities = ["public", "private"] as const;

export function isBoardMode(value: string): value is NewBoard["mode"] {
  return (boardModes as readonly string[]).includes(value);
}

export function isBoardVisibility(
  value: string,
): value is NewBoard["visibility"] {
  return (boardVisibilities as readonly string[]).includes(value);
}

type BoardAudit = {
  actorUserId: string;
  auditId: string;
};

type StoredBoard = {
  id: string;
  parentId: string | null;
  visibility: NewBoard["visibility"];
};

type BoardDescendant = { id: string; visibility: NewBoard["visibility"] };

function normalizeBoardDetails(input: {
  slug: string;
  title: string;
  description?: string;
  mode: string;
}) {
  const slug = input.slug.trim().toLowerCase();
  const title = input.title.trim();
  const description = (input.description ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    throw new Error(
      "Board slug must use lowercase letters, numbers, and hyphens.",
    );
  }
  if (!title || title.length > 120) {
    throw new Error("Board title must be between 1 and 120 characters.");
  }
  if (description.length > 2_000) {
    throw new Error("Board description must be 2,000 characters or fewer.");
  }
  if (!isBoardMode(input.mode)) throw new Error("Board mode is invalid.");
  return { slug, title, description, mode: input.mode };
}

function assertBoardAudit(audit: BoardAudit) {
  if (!audit.actorUserId.trim() || !audit.auditId.trim()) {
    throw new Error(
      "Board changes require an administrator and audit identifier.",
    );
  }
}

function boardAuditStatement(
  database: D1Database,
  audit: BoardAudit,
  action: string,
  boardId: string,
  metadata: Record<string, unknown>,
  now: string,
) {
  return database
    .prepare(
      "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, 'board', ?, ?, ?)",
    )
    .bind(
      audit.auditId,
      audit.actorUserId,
      action,
      boardId,
      JSON.stringify(metadata),
      now,
    );
}

async function loadStoredBoard(database: D1Database, boardId: string) {
  return database
    .prepare(
      "SELECT id, parent_id AS parentId, visibility FROM boards WHERE id = ? LIMIT 1",
    )
    .bind(boardId)
    .first<StoredBoard>();
}

async function privateBoardAncestorExists(
  database: D1Database,
  boardId: string,
  includeSelf = true,
) {
  const privateAncestor = await database
    .prepare(
      `SELECT 1 AS privateAncestor FROM board_closure AS path INNER JOIN boards AS ancestor ON ancestor.id = path.ancestor_id WHERE path.descendant_id = ? AND ancestor.visibility = 'private' ${includeSelf ? "" : "AND path.depth > 0"} LIMIT 1`,
    )
    .bind(boardId)
    .first<{ privateAncestor: number }>();
  return privateAncestor !== null;
}

async function listBoardDescendants(database: D1Database, boardId: string) {
  const descendants = await database
    .prepare(
      "SELECT boards.id, boards.visibility FROM board_closure INNER JOIN boards ON boards.id = board_closure.descendant_id WHERE board_closure.ancestor_id = ?",
    )
    .bind(boardId)
    .all<BoardDescendant>();
  return descendants.results;
}

export async function createBoard(
  database: D1Database,
  board: NewBoard & BoardAudit,
) {
  assertBoardAudit(board);
  if (!board.id.trim()) throw new Error("A board identifier is required.");
  const details = normalizeBoardDetails(board);
  if (!isBoardVisibility(board.visibility)) {
    throw new Error("Board visibility is invalid.");
  }
  const sortOrder = board.sortOrder ?? 0;
  if (!Number.isSafeInteger(sortOrder)) {
    throw new Error("Board sort order must be an integer.");
  }
  if (board.parentId) {
    const parent = await loadStoredBoard(database, board.parentId);
    if (!parent) throw new Error("Parent board does not exist.");
    if (
      board.visibility === "public" &&
      (await privateBoardAncestorExists(database, parent.id))
    ) {
      throw new Error("A public board cannot be nested under a private board.");
    }
  }
  const now = new Date().toISOString();
  const statements = [
    database
      .prepare(
        "INSERT INTO boards (id, parent_id, slug, title, description, mode, visibility, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        board.id,
        board.parentId,
        details.slug,
        details.title,
        details.description,
        details.mode,
        board.visibility,
        sortOrder,
        now,
        now,
      ),
    ...createBoardClosureStatements(board.id, board.parentId).map((item) =>
      database.prepare(item.sql).bind(...item.params),
    ),
    boardAuditStatement(
      database,
      board,
      "board.create",
      board.id,
      {
        parentId: board.parentId,
        visibility: board.visibility,
        mode: details.mode,
      },
      now,
    ),
  ];
  await database.batch(statements);
}

export async function moveBoard(
  database: D1Database,
  input: BoardAudit & { boardId: string; newParentId: string | null },
) {
  assertBoardAudit(input);
  if (!input.boardId.trim()) throw new Error("A board identifier is required.");
  if (input.newParentId !== null && !input.newParentId.trim()) {
    throw new Error("New parent board identifier is invalid.");
  }
  const board = await loadStoredBoard(database, input.boardId);
  if (!board) throw new Error("Board does not exist.");
  const descendants = await listBoardDescendants(database, input.boardId);
  assertMoveBoard(
    input.boardId,
    input.newParentId,
    descendants.map((descendant) => descendant.id),
  );
  if (input.newParentId) {
    const parent = await loadStoredBoard(database, input.newParentId);
    if (!parent) throw new Error("New parent board does not exist.");
    if (
      (await privateBoardAncestorExists(database, parent.id)) &&
      descendants.some((descendant) => descendant.visibility === "public")
    ) {
      throw new Error("A public board cannot be nested under a private board.");
    }
  }
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare("UPDATE boards SET parent_id = ?, updated_at = ? WHERE id = ?")
      .bind(input.newParentId, now, input.boardId),
    ...moveBoardClosureStatements(input.boardId, input.newParentId).map(
      (item) => database.prepare(item.sql).bind(...item.params),
    ),
    boardAuditStatement(
      database,
      input,
      "board.move",
      input.boardId,
      {
        previousParentId: board.parentId,
        newParentId: input.newParentId,
      },
      now,
    ),
  ]);
}

export async function updateBoard(
  database: D1Database,
  input: BoardAudit & {
    boardId: string;
    slug: string;
    title: string;
    description: string;
    mode: NewBoard["mode"];
  },
) {
  assertBoardAudit(input);
  const details = normalizeBoardDetails(input);
  const board = await loadStoredBoard(database, input.boardId);
  if (!board) throw new Error("Board does not exist.");
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "UPDATE boards SET slug = ?, title = ?, description = ?, mode = ?, updated_at = ? WHERE id = ?",
      )
      .bind(
        details.slug,
        details.title,
        details.description,
        details.mode,
        now,
        input.boardId,
      ),
    boardAuditStatement(
      database,
      input,
      "board.update",
      input.boardId,
      {
        slug: details.slug,
        mode: details.mode,
      },
      now,
    ),
  ]);
}

export async function setBoardMode(
  database: D1Database,
  input: BoardAudit & { boardId: string; mode: NewBoard["mode"] },
) {
  assertBoardAudit(input);
  if (!isBoardMode(input.mode)) throw new Error("Board mode is invalid.");
  if (!(await loadStoredBoard(database, input.boardId))) {
    throw new Error("Board does not exist.");
  }
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare("UPDATE boards SET mode = ?, updated_at = ? WHERE id = ?")
      .bind(input.mode, now, input.boardId),
    boardAuditStatement(
      database,
      input,
      "board.mode",
      input.boardId,
      {
        mode: input.mode,
      },
      now,
    ),
  ]);
}

export async function setBoardSortOrder(
  database: D1Database,
  input: BoardAudit & { boardId: string; sortOrder: number },
) {
  assertBoardAudit(input);
  if (!Number.isSafeInteger(input.sortOrder)) {
    throw new Error("Board sort order must be an integer.");
  }
  if (!(await loadStoredBoard(database, input.boardId))) {
    throw new Error("Board does not exist.");
  }
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare("UPDATE boards SET sort_order = ?, updated_at = ? WHERE id = ?")
      .bind(input.sortOrder, now, input.boardId),
    boardAuditStatement(
      database,
      input,
      "board.reorder",
      input.boardId,
      {
        sortOrder: input.sortOrder,
      },
      now,
    ),
  ]);
}

export async function setBoardVisibility(
  database: D1Database,
  input: BoardAudit & { boardId: string; visibility: NewBoard["visibility"] },
) {
  assertBoardAudit(input);
  if (!isBoardVisibility(input.visibility)) {
    throw new Error("Board visibility is invalid.");
  }
  const board = await loadStoredBoard(database, input.boardId);
  if (!board) throw new Error("Board does not exist.");
  if (board.visibility === input.visibility) return false;
  if (
    input.visibility === "public" &&
    board.parentId &&
    (await privateBoardAncestorExists(database, board.id, false))
  ) {
    throw new Error("A board under a private parent cannot become public.");
  }
  if (input.visibility === "private") {
    const publicPost = await database
      .prepare(
        "SELECT 1 AS publicPost FROM posts INNER JOIN threads ON threads.id = posts.thread_id INNER JOIN board_closure ON board_closure.descendant_id = threads.board_id WHERE board_closure.ancestor_id = ? AND posts.origin = 'local' AND posts.visibility = 'public' LIMIT 1",
      )
      .bind(input.boardId)
      .first<{ publicPost: number }>();
    if (publicPost) {
      throw new Error(
        "A board with public posts cannot become private; remove public content first.",
      );
    }
  }
  const now = new Date().toISOString();
  const scope = input.visibility === "private" ? "descendant" : "single";
  await database.batch([
    database
      .prepare(
        input.visibility === "private"
          ? "UPDATE boards SET visibility = 'private', updated_at = ? WHERE id IN (SELECT descendant_id FROM board_closure WHERE ancestor_id = ?)"
          : "UPDATE boards SET visibility = 'public', updated_at = ? WHERE id = ?",
      )
      .bind(now, input.boardId),
    boardAuditStatement(
      database,
      input,
      "board.visibility",
      input.boardId,
      {
        previousVisibility: board.visibility,
        visibility: input.visibility,
        scope,
      },
      now,
    ),
  ]);
  return true;
}

export async function listManagedBoards(database: D1Database) {
  return database
    .prepare(
      "SELECT id, parent_id AS parentId, slug, title, description, mode, visibility, sort_order AS sortOrder FROM boards ORDER BY sort_order ASC, title ASC",
    )
    .all<ManagedBoard>();
}
