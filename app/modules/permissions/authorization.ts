export type Permission =
  | "site.manage"
  | "users.manage"
  | "groups.manage"
  | "federation.manage"
  | "boards.manage"
  | "boards.view"
  | "threads.create"
  | "posts.reply"
  | "posts.edit_any"
  | "posts.delete_any"
  | "threads.pin"
  | "threads.lock"
  | "reports.manage"
  | "audit.view";

export type AuthorizationRequest = {
  userId: string | null;
  permission: Permission;
  boardId?: string;
};
export type PermissionGrant = {
  groupId: string;
  permission: Permission;
  boardId: string | null;
};

export type AuthorizationDecision = {
  allowed: boolean;
  reason: "anonymous" | "missing_grant" | "granted";
  matchedGrant?: PermissionGrant;
};

export function authorize(
  request: AuthorizationRequest,
  groupIds: readonly string[],
  grants: readonly PermissionGrant[],
  boardAncestorIds: readonly string[] = [],
): AuthorizationDecision {
  if (!request.userId) return { allowed: false, reason: "anonymous" };
  const groups = new Set(groupIds);
  const eligibleBoards = new Set(
    request.boardId ? [request.boardId, ...boardAncestorIds] : [],
  );
  const matchedGrant = grants.find(
    (grant) =>
      groups.has(grant.groupId) &&
      grant.permission === request.permission &&
      (grant.boardId === null || eligibleBoards.has(grant.boardId)),
  );
  return matchedGrant
    ? { allowed: true, reason: "granted", matchedGrant }
    : { allowed: false, reason: "missing_grant" };
}
