import { redirect } from "react-router";

import type { Route } from "./+types/posts.$postId.like";
import {
  canViewForumBoard,
  canViewPrivateForumContent,
} from "@/modules/forum/access.server";
import { createNotification } from "@/modules/forum/notifications/service";
import { loadForumBoard } from "@/modules/forum/read.server";
import { togglePostLike } from "@/modules/forum/posts/likes";
import { getSession } from "@/modules/identity/auth.server";

type LikeablePost = {
  id: string;
  threadId: string;
  boardId: string;
  authorUserId: string | null;
  visibility: "public" | "private";
};

async function loadLikeablePost(database: D1Database, postId: string) {
  return database
    .prepare(
      "SELECT posts.id, posts.thread_id AS threadId, threads.board_id AS boardId, posts.author_user_id AS authorUserId, posts.visibility FROM posts INNER JOIN threads ON threads.id = posts.thread_id WHERE posts.id = ? AND posts.state = 'published'",
    )
    .bind(postId)
    .first<LikeablePost>();
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");

  const post = await loadLikeablePost(
    context.cloudflare.env.DB,
    params.postId ?? "",
  );
  if (!post) throw new Response("Not found", { status: 404 });
  const board = await loadForumBoard(context.cloudflare.env.DB, post.boardId);
  if (!board) throw new Response("Not found", { status: 404 });
  const [canView, canViewPrivate] = await Promise.all([
    canViewForumBoard(context.cloudflare.env.DB, board, session.user.id),
    canViewPrivateForumContent(
      context.cloudflare.env.DB,
      board,
      session.user.id,
    ),
  ]);
  if (!canView || (post.visibility === "private" && !canViewPrivate)) {
    throw new Response("Not found", { status: 404 });
  }

  const result = await togglePostLike(
    context.cloudflare.env.DB,
    post.id,
    session.user.id,
  );
  if (result === "added" && post.authorUserId) {
    await createNotification(context.cloudflare.env.DB, {
      id: crypto.randomUUID(),
      recipientUserId: post.authorUserId,
      actorId: session.user.id,
      type: "like",
      threadId: post.threadId,
      postId: post.id,
    });
  }
  return redirect(`/threads/${post.threadId}`);
}
