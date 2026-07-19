export function nextLikeState(
  existingActorIds: ReadonlySet<string>,
  actorId: string,
) {
  const actorIds = new Set(existingActorIds);
  if (actorIds.has(actorId)) {
    actorIds.delete(actorId);
    return { actorIds, action: "removed" as const };
  }
  actorIds.add(actorId);
  return { actorIds, action: "added" as const };
}
