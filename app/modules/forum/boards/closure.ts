export function createBoardClosureStatements(
  boardId: string,
  parentId: string | null,
) {
  const statements = [
    {
      sql: "INSERT INTO board_closure (ancestor_id, descendant_id, depth) VALUES (?, ?, 0)",
      params: [boardId, boardId],
    },
  ];
  if (parentId)
    statements.push({
      sql: "INSERT INTO board_closure (ancestor_id, descendant_id, depth) SELECT ancestor_id, ?, depth + 1 FROM board_closure WHERE descendant_id = ?",
      params: [boardId, parentId],
    });
  return statements;
}
