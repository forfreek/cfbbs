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

export function moveBoardClosureStatements(
  boardId: string,
  newParentId: string | null,
) {
  const statements = [
    {
      sql: "DELETE FROM board_closure WHERE descendant_id IN (SELECT descendant_id FROM board_closure WHERE ancestor_id = ?) AND ancestor_id NOT IN (SELECT descendant_id FROM board_closure WHERE ancestor_id = ?)",
      params: [boardId, boardId],
    },
  ];
  if (newParentId) {
    statements.push({
      sql: "INSERT INTO board_closure (ancestor_id, descendant_id, depth) SELECT new_ancestor.ancestor_id, subtree.descendant_id, new_ancestor.depth + subtree.depth + 1 FROM board_closure AS new_ancestor CROSS JOIN board_closure AS subtree WHERE new_ancestor.descendant_id = ? AND subtree.ancestor_id = ?",
      params: [newParentId, boardId],
    });
  }
  return statements;
}
