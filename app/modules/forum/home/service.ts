export type HomeBoard = {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  mode: "container" | "posting" | "read_only";
};

export type HomeTopic = {
  id: string;
  boardId: string;
  boardTitle: string;
  title: string;
  authorName: string;
  replyCount: number;
  activityAt: string;
  isPinned?: number;
};

export const homeSorts = ["latest", "active", "unreplied"] as const;
export type HomeSort = (typeof homeSorts)[number];

export type HomeCursor = {
  sort: HomeSort;
  activityAt: string;
  id: string;
  replyCount: number;
};

type HomeDatabase = Pick<D1Database, "prepare">;

const publicBoardQuery = `
  SELECT
    boards.id,
    boards.parent_id AS parentId,
    boards.slug,
    boards.title,
    boards.mode
  FROM boards
  WHERE boards.visibility = 'public'
    AND NOT EXISTS (
      SELECT 1
      FROM board_closure AS path
      INNER JOIN boards AS ancestor ON ancestor.id = path.ancestor_id
      WHERE path.descendant_id = boards.id
        AND ancestor.visibility != 'public'
    )
  ORDER BY boards.sort_order ASC, boards.title ASC
`;

const publicTopicQuery = `
  SELECT
    threads.id,
    threads.board_id AS boardId,
    boards.title AS boardTitle,
    threads.title,
    threads.is_pinned AS isPinned,
    COALESCE(profiles.display_name, profiles.handle, '未署名用户') AS authorName,
    (
      SELECT COUNT(*)
      FROM posts AS reply
      WHERE reply.thread_id = threads.id
        AND reply.id != threads.first_post_id
        AND reply.visibility = 'public'
        AND reply.state = 'published'
    ) AS replyCount,
    (
      SELECT MAX(activity_post.published_at)
      FROM posts AS activity_post
      WHERE activity_post.thread_id = threads.id
        AND activity_post.visibility = 'public'
        AND activity_post.state = 'published'
    ) AS activityAt
  FROM threads
  INNER JOIN boards ON boards.id = threads.board_id
  INNER JOIN posts AS first_post ON first_post.id = threads.first_post_id
  LEFT JOIN profiles ON profiles.user_id = first_post.author_user_id
  WHERE boards.visibility = 'public'
    AND first_post.origin = 'local'
    AND first_post.visibility = 'public'
    AND first_post.state = 'published'
    AND NOT EXISTS (
      SELECT 1
      FROM board_closure AS path
      INNER JOIN boards AS ancestor ON ancestor.id = path.ancestor_id
      WHERE path.descendant_id = boards.id
        AND ancestor.visibility != 'public'
    )
`;

function publicTopicQueryFor(sort: HomeSort) {
  const sortClause =
    sort === "active"
      ? "ORDER BY threads.is_pinned DESC, replyCount DESC, activityAt DESC, threads.id DESC"
      : "ORDER BY threads.is_pinned DESC, activityAt DESC, threads.id DESC";
  const unrepliedClause =
    sort === "unreplied"
      ? `
  AND NOT EXISTS (
    SELECT 1
    FROM posts AS reply
    WHERE reply.thread_id = threads.id
      AND reply.id != threads.first_post_id
      AND reply.visibility = 'public'
      AND reply.state = 'published'
  )`
      : "";
  return `${publicTopicQuery}${unrepliedClause}
  ${sortClause}
  LIMIT 50`;
}

export function encodeHomeCursor(cursor: HomeCursor) {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeHomeCursor(value: string | null, sort: HomeSort) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed: unknown = JSON.parse(
      atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "=")),
    );
    if (!parsed || typeof parsed !== "object") return null;
    const cursor = parsed as Record<string, unknown>;
    if (
      cursor.sort !== sort ||
      typeof cursor.activityAt !== "string" ||
      typeof cursor.id !== "string" ||
      typeof cursor.replyCount !== "number"
    ) {
      return null;
    }
    return {
      sort,
      activityAt: cursor.activityAt,
      id: cursor.id,
      replyCount: cursor.replyCount,
    } satisfies HomeCursor;
  } catch {
    return null;
  }
}

export function parseHomeSort(value: string | null): HomeSort {
  return homeSorts.includes(value as HomeSort) ? (value as HomeSort) : "latest";
}

export async function loadPublicHome(
  database: HomeDatabase,
  sort: HomeSort = "latest",
  cursor: HomeCursor | null = null,
) {
  const unrepliedClause =
    sort === "unreplied"
      ? `
  AND NOT EXISTS (
    SELECT 1
    FROM posts AS reply
    WHERE reply.thread_id = threads.id
      AND reply.id != threads.first_post_id
      AND reply.visibility = 'public'
      AND reply.state = 'published'
  )`
      : "";
  const orderClause =
    sort === "active"
      ? "ORDER BY isPinned DESC, replyCount DESC, activityAt DESC, id DESC"
      : "ORDER BY isPinned DESC, activityAt DESC, id DESC";
  const cursorClause = cursor
    ? sort === "active"
      ? "WHERE (replyCount < ? OR (replyCount = ? AND (activityAt < ? OR (activityAt = ? AND id < ?))))"
      : "WHERE (activityAt < ? OR (activityAt = ? AND id < ?))"
    : "";
  const topicQuery = `WITH public_topics AS (${publicTopicQuery}${unrepliedClause}) SELECT * FROM public_topics ${cursorClause} ${orderClause} LIMIT ${cursor ? "?" : "51"}`;
  const topicParams = cursor
    ? sort === "active"
      ? [
          cursor.replyCount,
          cursor.replyCount,
          cursor.activityAt,
          cursor.activityAt,
          cursor.id,
          51,
        ]
      : [cursor.activityAt, cursor.activityAt, cursor.id, 51]
    : [];
  const topicStatement = database.prepare(topicQuery);
  const [boardResult, topicResult] = await Promise.all([
    database.prepare(publicBoardQuery).all<HomeBoard>(),
    cursor
      ? topicStatement
          .bind(...topicParams)
          .all<HomeTopic & { isPinned: number }>()
      : topicStatement.all<HomeTopic & { isPinned: number }>(),
  ]);
  const topics = topicResult.results.slice(0, 50);
  const finalTopic = topics.at(-1);
  const result: {
    boards: HomeBoard[];
    topics: HomeTopic[];
    nextCursor?: string | null;
  } = {
    boards: boardResult.results,
    topics,
  };
  if (topicResult.results.length > 50 && finalTopic) {
    result.nextCursor = encodeHomeCursor({
      sort,
      activityAt: finalTopic.activityAt,
      id: finalTopic.id,
      replyCount: finalTopic.replyCount,
    });
  }
  return result;
}

export function boardGroups(boards: readonly HomeBoard[]) {
  const childrenByParent = new Map<string, HomeBoard[]>();
  for (const board of boards) {
    if (!board.parentId) continue;
    const children = childrenByParent.get(board.parentId) ?? [];
    children.push(board);
    childrenByParent.set(board.parentId, children);
  }

  function descendants(
    parentId: string,
    depth: number,
  ): Array<HomeBoard & { depth: number }> {
    return (childrenByParent.get(parentId) ?? []).flatMap((board) => [
      { ...board, depth },
      ...descendants(board.id, depth + 1),
    ]);
  }

  return boards
    .filter((board) => board.parentId === null)
    .map((board) => ({ board, items: descendants(board.id, 0) }));
}

export const publicHomeQueries = {
  publicBoardQuery,
  publicTopicQuery: publicTopicQueryFor("latest"),
  activeTopicQuery: publicTopicQueryFor("active"),
  unrepliedTopicQuery: publicTopicQueryFor("unreplied"),
};
