import { redirect } from "react-router";

import type { Route } from "./+types/posts.$postId.report";
import {
  canViewForumBoard,
  canViewPrivateForumContent,
} from "@/modules/forum/access.server";
import { loadForumBoard } from "@/modules/forum/read.server";
import { createReport } from "@/modules/moderation/reports";
import { getSession } from "@/modules/identity/auth.server";

type ReportablePost = {
  id: string;
  threadId: string;
  boardId: string;
  visibility: "public" | "private";
};

async function loadReportablePost(database: D1Database, postId: string) {
  return database
    .prepare(
      "SELECT posts.id, posts.thread_id AS threadId, threads.board_id AS boardId, posts.visibility FROM posts INNER JOIN threads ON threads.id = posts.thread_id WHERE posts.id = ? AND posts.state = 'published'",
    )
    .bind(postId)
    .first<ReportablePost>();
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const post = await loadReportablePost(
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

  const form = await request.formData();
  await createReport(context.cloudflare.env.DB, {
    id: crypto.randomUUID(),
    reporterUserId: session.user.id,
    reporterActorId: null,
    postId: post.id,
    reason: String(form.get("reason") ?? ""),
  });
  return redirect(`/threads/${post.threadId}#post-${post.id}`);
}
