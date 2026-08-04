import { createNotification } from "@/modules/forum/notifications/service";

export type LocalProfileRef = {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
};

export type LocalFollowCursor = { createdAt: string; userId: string };

export function encodeLocalFollowCursor(cursor: LocalFollowCursor) {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeLocalFollowCursor(value: string | null) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed: unknown = JSON.parse(
      atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "=")),
    );
    if (!parsed || typeof parsed !== "object") return null;
    const cursor = parsed as Record<string, unknown>;
    if (
      typeof cursor.createdAt !== "string" ||
      typeof cursor.userId !== "string"
    )
      return null;
    return { createdAt: cursor.createdAt, userId: cursor.userId };
  } catch {
    return null;
  }
}

export async function isFollowingLocal(
  database: D1Database,
  followerUserId: string,
  followingUserId: string,
) {
  const row = await database
    .prepare(
      "SELECT 1 AS present FROM local_follows WHERE follower_user_id = ? AND following_user_id = ? LIMIT 1",
    )
    .bind(followerUserId, followingUserId)
    .first<{ present: number }>();
  return row !== null;
}

export async function setLocalFollow(
  database: D1Database,
  input: {
    followerUserId: string;
    followingUserId: string;
    following: boolean;
  },
) {
  if (input.followerUserId === input.followingUserId) {
    return { ok: false as const, message: "不能关注自己。" };
  }
  const target = await database
    .prepare("SELECT id, status FROM user WHERE id = ? LIMIT 1")
    .bind(input.followingUserId)
    .first<{ id: string; status: string }>();
  if (!target || target.status !== "active") {
    return { ok: false as const, message: "用户不存在或不可关注。" };
  }
  if (input.following) {
    await database
      .prepare(
        "INSERT OR IGNORE INTO local_follows (follower_user_id, following_user_id, created_at) VALUES (?, ?, ?)",
      )
      .bind(
        input.followerUserId,
        input.followingUserId,
        new Date().toISOString(),
      )
      .run();
    await createNotification(database, {
      id: crypto.randomUUID(),
      recipientUserId: input.followingUserId,
      actorId: input.followerUserId,
      type: "follow",
    });
  } else {
    await database
      .prepare(
        "DELETE FROM local_follows WHERE follower_user_id = ? AND following_user_id = ?",
      )
      .bind(input.followerUserId, input.followingUserId)
      .run();
  }
  return { ok: true as const, following: input.following };
}

export async function listLocalFollowProfiles(
  database: D1Database,
  input: {
    userId: string;
    direction: "followers" | "following";
    cursor?: LocalFollowCursor | null;
  },
) {
  const userColumn =
    input.direction === "followers"
      ? "local_follows.following_user_id"
      : "local_follows.follower_user_id";
  const joinColumn =
    input.direction === "followers"
      ? "local_follows.follower_user_id"
      : "local_follows.following_user_id";
  const predicate = input.cursor
    ? "AND (local_follows.created_at < ? OR (local_follows.created_at = ? AND profiles.user_id < ?))"
    : "";
  const params = input.cursor
    ? [
        input.userId,
        input.cursor.createdAt,
        input.cursor.createdAt,
        input.cursor.userId,
        51,
      ]
    : [input.userId, 51];
  const rows = await database
    .prepare(
      `SELECT profiles.user_id AS userId, profiles.handle, profiles.display_name AS displayName,
              profiles.avatar_url AS avatarUrl, local_follows.created_at AS createdAt
       FROM local_follows
       INNER JOIN profiles ON profiles.user_id = ${userColumn}
       INNER JOIN user AS followed_user ON followed_user.id = ${joinColumn}
       WHERE ${userColumn} = ? AND followed_user.status = 'active' ${predicate}
       ORDER BY local_follows.created_at DESC, profiles.user_id DESC
       LIMIT ?`,
    )
    .bind(...params)
    .all<LocalProfileRef & { createdAt: string }>();
  const results = rows.results.slice(0, 50);
  const last = results.at(-1);
  return {
    results,
    nextCursor:
      rows.results.length > 50 && last
        ? encodeLocalFollowCursor({
            createdAt: last.createdAt,
            userId: last.userId,
          })
        : null,
  };
}
