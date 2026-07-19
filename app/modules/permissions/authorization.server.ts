import {
  authorize,
  type AuthorizationDecision,
  type AuthorizationRequest,
  type PermissionGrant,
} from "./authorization";

type GroupRow = { groupId: string };
type GrantRow = PermissionGrant;
type BoardAncestorRow = { ancestorId: string };

export async function authorizeDatabase(
  database: D1Database,
  request: AuthorizationRequest,
): Promise<AuthorizationDecision> {
  if (!request.userId) return authorize(request, [], []);

  const groups = await database
    .prepare("SELECT group_id AS groupId FROM group_members WHERE user_id = ?")
    .bind(request.userId)
    .all<GroupRow>();
  if (groups.results.length === 0) return authorize(request, [], []);

  const placeholders = groups.results.map(() => "?").join(", ");
  const grants = database
    .prepare(
      `SELECT group_id AS groupId, permission_key AS permission, board_id AS boardId FROM group_permissions WHERE group_id IN (${placeholders})`,
    )
    .bind(...groups.results.map((group) => group.groupId));
  const ancestors = request.boardId
    ? database
        .prepare(
          "SELECT ancestor_id AS ancestorId FROM board_closure WHERE descendant_id = ? ORDER BY depth ASC",
        )
        .bind(request.boardId)
    : null;
  const [grantResult, ancestorResult] = await Promise.all([
    grants.all<GrantRow>(),
    ancestors?.all<BoardAncestorRow>() ?? Promise.resolve({ results: [] }),
  ]);
  return authorize(
    request,
    groups.results.map((group) => group.groupId),
    grantResult.results,
    ancestorResult.results.map((ancestor) => ancestor.ancestorId),
  );
}
