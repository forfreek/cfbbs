import {
  canViewForumBoard,
  canViewPrivateForumContent,
} from "@/modules/forum/access.server";
import { loadForumBoard } from "@/modules/forum/read.server";
import { getSession } from "@/modules/identity/auth.server";

import { loadMediaObject } from "./storage";

export type MediaAccessContext = {
  postId: string | null;
  visibility: "public" | "private" | null;
  boardId: string | null;
  postState: "published" | "hidden" | "deleted" | null;
};

export async function loadMediaAccessContext(
  database: D1Database,
  mediaId: string,
) {
  return database
    .prepare(
      `SELECT post_attachments.post_id AS postId,
              posts.visibility AS visibility,
              posts.state AS postState,
              threads.board_id AS boardId
       FROM post_attachments
       INNER JOIN posts ON posts.id = post_attachments.post_id
       INNER JOIN threads ON threads.id = posts.thread_id
       WHERE post_attachments.media_id = ?
       ORDER BY CASE WHEN posts.state = 'published' THEN 0 ELSE 1 END,
                CASE WHEN posts.visibility = 'public' THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .bind(mediaId)
    .first<MediaAccessContext>();
}

export async function authorizeMediaRead(input: {
  request: Request;
  env: Env;
  mediaId: string;
}) {
  const media = await loadMediaObject(input.env.DB, input.mediaId);
  if (!media || media.deletedAt) {
    return { ok: false as const, status: 404 as const, media: null };
  }

  const linked = await loadMediaAccessContext(input.env.DB, input.mediaId);
  if (!linked || linked.postState !== "published") {
    // Unattached or unpublished media is only readable by the uploader.
    const session = await getSession(input.request, input.env);
    if (!session || session.user.id !== media.uploaderUserId) {
      return { ok: false as const, status: 404 as const, media: null };
    }
    return { ok: true as const, media, visibility: "private" as const };
  }

  if (linked.visibility === "public") {
    return { ok: true as const, media, visibility: "public" as const };
  }

  const session = await getSession(input.request, input.env);
  if (!session || !linked.boardId) {
    return { ok: false as const, status: 401 as const, media: null };
  }
  const board = await loadForumBoard(input.env.DB, linked.boardId);
  if (!board) {
    return { ok: false as const, status: 404 as const, media: null };
  }
  const [canView, canViewPrivate] = await Promise.all([
    canViewForumBoard(input.env.DB, board, session.user.id),
    canViewPrivateForumContent(input.env.DB, board, session.user.id),
  ]);
  if (!canView || !canViewPrivate) {
    return { ok: false as const, status: 404 as const, media: null };
  }
  return { ok: true as const, media, visibility: "private" as const };
}
