import { redirect } from "react-router";
import type { Route } from "./+types/posts.$postId.react";
import { getSession } from "@/modules/identity/auth.server";
import { loadForumBoard } from "@/modules/forum/read.server";
import {
  canViewForumBoard,
  canViewPrivateForumContent,
} from "@/modules/forum/access.server";
import { toggleReaction } from "@/modules/forum/p2";
import { createEmojiReactActivity } from "@/modules/federation/outbox";

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const post = await context.cloudflare.env.DB.prepare(
    "SELECT posts.thread_id AS threadId, threads.board_id AS boardId, posts.visibility, posts.origin, posts.federation_object_id AS objectUri FROM posts INNER JOIN threads ON threads.id = posts.thread_id WHERE posts.id = ? AND posts.state = 'published'",
  )
    .bind(params.postId ?? "")
    .first<{
      threadId: string;
      boardId: string;
      visibility: "public" | "private";
      origin: "local" | "remote";
      objectUri: string | null;
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
  if (!canView || (post.visibility === "private" && !canViewPrivate))
    throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const emoji = String(form.get("emoji") ?? "");
  try {
    const result = await toggleReaction(context.cloudflare.env.DB, {
      postId: params.postId ?? "",
      actorId: session.user.id,
      emoji,
    });
    if (
      post.origin === "local" &&
      post.visibility === "public" &&
      post.objectUri
    ) {
      const actor = await context.cloudflare.env.DB.prepare(
        "SELECT handle FROM profiles WHERE user_id = ?",
      )
        .bind(session.user.id)
        .first<{ handle: string }>();
      if (actor) {
        const activity = createEmojiReactActivity({
          origin: context.cloudflare.env.APP_ORIGIN,
          actorHandle: actor.handle,
          activityId: crypto.randomUUID(),
          objectUri: post.objectUri,
          emoji,
        });
        const now = new Date().toISOString();
        await context.cloudflare.env.DB.prepare(
          "INSERT INTO federation_outbox_events (id, actor_id, aggregate_type, aggregate_id, activity_type, activity_json, delivery_scope, state, queued_at, created_at, updated_at) VALUES (?, ?, 'reaction', ?, 'EmojiReact', ?, 'followers', 'pending', NULL, ?, ?)",
        )
          .bind(
            crypto.randomUUID(),
            session.user.id,
            params.postId ?? "",
            JSON.stringify(activity),
            now,
            now,
          )
          .run();
      }
    }
    void result;
  } catch (error) {
    throw new Response(
      error instanceof Error ? error.message : "Reaction failed",
      { status: 400 },
    );
  }
  return redirect(`/threads/${post.threadId}#post-${params.postId}`);
}
