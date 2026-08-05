import {
  allowedReactionEmojis,
  validatePollVote,
  validateReactionEmoji,
} from "./content";
import { isSafeRemoteUrl } from "@/modules/federation/remote-url";

export type PollView = {
  postId: string;
  multiple: boolean;
  closesAt: string | null;
  hasVoted: boolean;
  options: { id: string; label: string; position: number; votes: number }[];
};

export async function loadPollView(
  database: D1Database,
  postId: string,
  userId: string | null,
): Promise<PollView | null> {
  const poll = await database
    .prepare(
      "SELECT post_id AS postId, multiple, closes_at AS closesAt FROM polls WHERE post_id = ?",
    )
    .bind(postId)
    .first<{ postId: string; multiple: number; closesAt: string | null }>();
  if (!poll) return null;
  const options = await database
    .prepare(
      "SELECT poll_options.id, label, position, COUNT(poll_votes.user_id) AS votes FROM poll_options LEFT JOIN poll_votes ON poll_votes.option_id = poll_options.id WHERE poll_options.poll_post_id = ? GROUP BY poll_options.id ORDER BY position ASC",
    )
    .bind(postId)
    .all<{ id: string; label: string; position: number; votes: number }>();
  const voted = userId
    ? await database
        .prepare(
          "SELECT 1 AS value FROM poll_votes WHERE poll_post_id = ? AND user_id = ? LIMIT 1",
        )
        .bind(postId, userId)
        .first<{ value: number }>()
    : null;
  return {
    postId,
    multiple: Boolean(poll.multiple),
    closesAt: poll.closesAt,
    hasVoted: Boolean(voted),
    options: options.results.map((option) => ({
      ...option,
      votes: Number(option.votes),
    })),
  };
}

export async function createPoll(
  database: D1Database,
  input: {
    postId: string;
    multiple: boolean;
    closesAt: string | null;
    options: readonly string[];
  },
) {
  await database.batch(
    pollInsertStatements(database, {
      ...input,
      createdAt: new Date().toISOString(),
    }),
  );
}

export function pollInsertStatements(
  database: D1Database,
  input: {
    postId: string;
    multiple: boolean;
    closesAt: string | null;
    options: readonly string[];
    createdAt: string;
  },
) {
  const now = input.createdAt;
  return [
    database
      .prepare(
        "INSERT INTO polls (post_id, multiple, closes_at, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(input.postId, input.multiple ? 1 : 0, input.closesAt, now),
    ...input.options.map((label, position) =>
      database
        .prepare(
          "INSERT INTO poll_options (id, poll_post_id, position, label) VALUES (?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), input.postId, position, label),
    ),
  ];
}

export async function voteInPoll(
  database: D1Database,
  input: { postId: string; userId: string; optionIds: readonly string[] },
) {
  const poll = await database
    .prepare(
      "SELECT multiple, closes_at AS closesAt FROM polls WHERE post_id = ?",
    )
    .bind(input.postId)
    .first<{ multiple: number; closesAt: string | null }>();
  if (!poll) throw new Error("投票不存在。");
  if (poll.closesAt && new Date(poll.closesAt).getTime() <= Date.now())
    throw new Error("投票已截止。");
  const vote = validatePollVote(input.optionIds, Boolean(poll.multiple));
  if (!vote.ok) throw new Error(vote.message);
  const existing = await database
    .prepare(
      "SELECT 1 AS value FROM poll_votes WHERE poll_post_id = ? AND user_id = ? LIMIT 1",
    )
    .bind(input.postId, input.userId)
    .first();
  if (existing) throw new Error("每个用户只能投票一次。");
  const valid = await database
    .prepare(
      `SELECT id FROM poll_options WHERE poll_post_id = ? AND id IN (${vote.optionIds.map(() => "?").join(",")})`,
    )
    .bind(input.postId, ...vote.optionIds)
    .all<{ id: string }>();
  if (valid.results.length !== vote.optionIds.length)
    throw new Error("投票选项无效。");
  const now = new Date().toISOString();
  await database.batch(
    vote.optionIds.map((optionId) =>
      database
        .prepare(
          "INSERT INTO poll_votes (poll_post_id, option_id, user_id, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(input.postId, optionId, input.userId, now),
    ),
  );
  return loadPollView(database, input.postId, input.userId);
}

export type ReactionSummary = {
  emoji: string;
  count: number;
  viewerReacted: boolean;
  customEmojiUrl: string | null;
};

export async function listReactionSummary(
  database: D1Database,
  postId: string,
  actorId: string | null,
) {
  const rows = await database
    .prepare(
      "SELECT emoji, custom_emoji_url AS customEmojiUrl, COUNT(*) AS count, SUM(CASE WHEN actor_id = ? THEN 1 ELSE 0 END) AS viewerCount FROM post_reactions WHERE post_id = ? GROUP BY emoji, custom_emoji_url ORDER BY count DESC, emoji ASC",
    )
    .bind(actorId, postId)
    .all<{
      emoji: string;
      customEmojiUrl: string | null;
      count: number;
      viewerCount: number;
    }>();
  return rows.results.map((row) => ({
    emoji: row.emoji,
    count: Number(row.count),
    viewerReacted: Number(row.viewerCount) > 0,
    customEmojiUrl: row.customEmojiUrl,
  }));
}

export async function toggleReaction(
  database: D1Database,
  input: { postId: string; actorId: string; emoji: string },
) {
  if (!validateReactionEmoji(input.emoji))
    throw new Error("不支持的表情反应。");
  const existing = await database
    .prepare(
      "SELECT 1 AS value FROM post_reactions WHERE post_id = ? AND actor_id = ? AND emoji = ?",
    )
    .bind(input.postId, input.actorId, input.emoji)
    .first();
  if (existing) {
    await database
      .prepare(
        "DELETE FROM post_reactions WHERE post_id = ? AND actor_id = ? AND emoji = ?",
      )
      .bind(input.postId, input.actorId, input.emoji)
      .run();
    return "removed" as const;
  }
  await database
    .prepare(
      "INSERT INTO post_reactions (post_id, actor_id, emoji, activity_id, custom_emoji_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
    )
    .bind(input.postId, input.actorId, input.emoji, new Date().toISOString())
    .run();
  return "added" as const;
}

export { allowedReactionEmojis };

export type BookmarkFolder = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
};

export async function listBookmarkFolders(
  database: D1Database,
  userId: string,
) {
  const rows = await database
    .prepare(
      "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt, (SELECT COUNT(*) FROM bookmark_folder_items INNER JOIN post_bookmarks ON post_bookmarks.user_id = bookmark_folder_items.user_id AND post_bookmarks.post_id = bookmark_folder_items.post_id WHERE bookmark_folder_items.folder_id = bookmark_folders.id) AS itemCount FROM bookmark_folders WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
    )
    .bind(userId)
    .all<BookmarkFolder>();
  return rows.results.map((row) => ({
    ...row,
    itemCount: Number(row.itemCount),
  }));
}

export async function createBookmarkFolder(
  database: D1Database,
  userId: string,
  name: string,
) {
  const clean = name.trim();
  if (!clean || clean.length > 80)
    throw new Error("文件夹名称需要 1 到 80 个字符。");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database
    .prepare(
      "INSERT INTO bookmark_folders (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, userId, clean, now, now)
    .run();
  return {
    id,
    name: clean,
    createdAt: now,
    updatedAt: now,
    itemCount: 0,
  } satisfies BookmarkFolder;
}

export async function moveBookmark(
  database: D1Database,
  input: { userId: string; folderId: string; postId: string; add: boolean },
) {
  const folder = await database
    .prepare("SELECT id FROM bookmark_folders WHERE id = ? AND user_id = ?")
    .bind(input.folderId, input.userId)
    .first();
  if (!folder) throw new Error("收藏夹不存在。");
  const bookmark = await database
    .prepare(
      "SELECT 1 AS present FROM post_bookmarks WHERE user_id = ? AND post_id = ? LIMIT 1",
    )
    .bind(input.userId, input.postId)
    .first();
  if (!bookmark) throw new Error("请先收藏帖子，再将它加入收藏夹。");
  if (input.add) {
    await database
      .prepare(
        "INSERT OR IGNORE INTO bookmark_folder_items (folder_id, user_id, post_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(
        input.folderId,
        input.userId,
        input.postId,
        new Date().toISOString(),
      )
      .run();
  } else {
    await database
      .prepare(
        "DELETE FROM bookmark_folder_items WHERE folder_id = ? AND user_id = ? AND post_id = ?",
      )
      .bind(input.folderId, input.userId, input.postId)
      .run();
  }
}

export function isSafeQuoteUri(uri: string, origin?: string) {
  try {
    const url = new URL(uri);
    if (origin && url.origin === new URL(origin).origin) return true;
    return isSafeRemoteUrl(uri);
  } catch {
    return false;
  }
}
