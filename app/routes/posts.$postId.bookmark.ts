import { redirect } from "react-router";

import type { Route } from "./+types/posts.$postId.bookmark";
import {
  canViewForumBoard,
  canViewPrivateForumContent,
} from "@/modules/forum/access.server";
import { loadForumBoard } from "@/modules/forum/read.server";
import { setPostBookmark } from "@/modules/forum/bookmarks";
import { getSession } from "@/modules/identity/auth.server";

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const post = await context.cloudflare.env.DB.prepare(
    "SELECT posts.id, posts.thread_id AS threadId, posts.visibility, threads.board_id AS boardId FROM posts INNER JOIN threads ON threads.id = posts.thread_id WHERE posts.id = ? AND posts.state = 'published' LIMIT 1",
  )
    .bind(params.postId ?? "")
    .first<{
      id: string;
      threadId: string;
      visibility: "public" | "private";
      boardId: string;
    }>();
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
  const form = await request.formData();
  const bookmarked = String(form.get("bookmarked") ?? "false") === "true";
  await setPostBookmark(context.cloudflare.env.DB, {
    userId: session.user.id,
    postId: post.id,
    bookmarked,
  });
  const returnTo = String(form.get("returnTo") ?? "");
  if (returnTo.startsWith("/bookmarks")) return redirect(returnTo);
  return redirect(`/threads/${post.threadId}#post-${post.id}`);
}
