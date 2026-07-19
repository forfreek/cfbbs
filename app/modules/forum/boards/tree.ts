export type BoardPath = { id: string; ancestorIds: readonly string[] };

export function canMoveBoard(
  boardId: string,
  newParentId: string | null,
  subtreeIds: readonly string[],
) {
  return (
    newParentId === null ||
    (newParentId !== boardId && !subtreeIds.includes(newParentId))
  );
}

export function assertMoveBoard(
  boardId: string,
  newParentId: string | null,
  subtreeIds: readonly string[],
) {
  if (!canMoveBoard(boardId, newParentId, subtreeIds))
    throw new Error(
      "A board cannot be moved into itself or one of its descendants.",
    );
}
