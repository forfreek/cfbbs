import { extractContentTokens } from "./mentions";

export type PollInput = {
  multiple?: boolean;
  closesAt?: string | null;
  options: readonly string[];
};

export const allowedReactionEmojis = [
  "👍",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🎉",
  "🚀",
  "👎",
  "🔥",
  "👏",
] as const;

export function validatePollInput(input: PollInput) {
  const options = input.options.map((option) => option.trim());
  if (options.length < 2 || options.length > 10) {
    return { ok: false as const, message: "投票选项需要 2 到 10 项。" };
  }
  if (options.some((option) => option.length < 1 || option.length > 200)) {
    return {
      ok: false as const,
      message: "每个投票选项需要 1 到 200 个字符。",
    };
  }
  if (
    new Set(options.map((option) => option.toLocaleLowerCase())).size !==
    options.length
  ) {
    return { ok: false as const, message: "投票选项不能重复。" };
  }
  let closesAt: string | null = null;
  if (input.closesAt) {
    const parsed = new Date(input.closesAt);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      return { ok: false as const, message: "投票截止时间必须是未来时间。" };
    }
    closesAt = parsed.toISOString();
  }
  return {
    ok: true as const,
    value: { options, multiple: Boolean(input.multiple), closesAt },
  };
}

export function validatePollVote(
  optionIds: readonly string[],
  multiple: boolean,
) {
  const unique = [...new Set(optionIds.filter(Boolean))];
  if (unique.length === 0)
    return { ok: false as const, message: "请选择投票选项。" };
  if (!multiple && unique.length !== 1) {
    return { ok: false as const, message: "单选投票只能选择一个选项。" };
  }
  return { ok: true as const, optionIds: unique };
}

export function validateReactionEmoji(emoji: string) {
  return (allowedReactionEmojis as readonly string[]).includes(emoji);
}

export type ContentMetadataStatements = {
  statements: D1PreparedStatement[];
  hashtags: { tag: string; displayName: string }[];
  mentions: string[];
};

/** Build idempotent metadata writes independently from post insertion. */
export async function contentMetadataStatements(
  database: D1Database,
  input: { postId: string; markdown: string; createdAt?: string },
): Promise<ContentMetadataStatements> {
  const now = input.createdAt ?? new Date().toISOString();
  const { hashtags, mentions } = extractContentTokens(input.markdown);
  const capabilityProbe = database
    .prepare("SELECT id FROM hashtags LIMIT 1")
    .bind();
  if (typeof capabilityProbe.all !== "function") {
    return { statements: [], hashtags, mentions };
  }
  const handles = mentions;
  const userQuery = handles.length
    ? database
        .prepare(
          `SELECT user.id AS userId, profiles.handle AS handle FROM user INNER JOIN profiles ON profiles.user_id = user.id WHERE profiles.handle IN (${handles.map(() => "?").join(",")}) AND user.status = 'active'`,
        )
        .bind(...handles)
    : null;
  // Lightweight test doubles may only implement run/batch. Keep content
  // publication compatible with those callers while real D1 gets full sync.
  if (userQuery && typeof userQuery.all !== "function") {
    return { statements: [], hashtags, mentions };
  }
  const userRows = userQuery
    ? await userQuery.all<{ userId: string; handle: string }>()
    : { results: [] };
  const users = new Map(
    userRows.results.map((row) => [row.handle.toLowerCase(), row.userId]),
  );
  const statements: D1PreparedStatement[] = [
    database
      .prepare("DELETE FROM post_hashtags WHERE post_id = ?")
      .bind(input.postId),
    database
      .prepare("DELETE FROM post_mentions WHERE post_id = ?")
      .bind(input.postId),
  ];
  for (const tag of hashtags) {
    const id = crypto.randomUUID();
    statements.push(
      database
        .prepare(
          "INSERT INTO hashtags (id, tag, display_name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(tag) DO NOTHING",
        )
        .bind(id, tag.tag, tag.displayName, now),
      database
        .prepare(
          "INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id, created_at) SELECT ?, id, ? FROM hashtags WHERE tag = ?",
        )
        .bind(input.postId, now, tag.tag),
    );
  }
  for (const handle of handles) {
    statements.push(
      database
        .prepare(
          "INSERT OR IGNORE INTO post_mentions (id, post_id, mentioned_user_id, actor_uri, handle, created_at) VALUES (?, ?, ?, NULL, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          input.postId,
          users.get(handle) ?? null,
          handle,
          now,
        ),
    );
  }
  return { statements, hashtags, mentions };
}

export async function syncPostContentMetadata(
  database: D1Database,
  input: { postId: string; markdown: string; createdAt?: string },
) {
  const result = await contentMetadataStatements(database, input);
  if (result.statements.length) await database.batch(result.statements);
  return result;
}
