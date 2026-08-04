import { redirect } from "react-router";
import type { Route } from "./+types/posts.$postId.react";
import { getSession } from "@/modules/identity/auth.server";
import { loadForumBoard } from "@/modules/forum/read.server";
import {
  canViewForumBoard,
  canViewPrivateForumContent,
} from "@/modules/forum/access.server";
import { toggleReaction } from "@/modules/forum/p2";
import {
  createEmojiReactActivity,
  createUndoEmojiReactActivity,
} from "@/modules/federation/outbox";

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const post = await context.cloudflare.env.DB.prepare(
    "SELECT posts.thread_id AS threadId, threads.board_id AS boardId, boards.visibility AS boardVisibility, posts.visibility, posts.origin, posts.federation_object_id AS objectUri FROM posts INNER JOIN threads ON threads.id = posts.thread_id INNER JOIN boards ON boards.id = threads.board_id WHERE posts.id = ? AND posts.state = 'published'",
  )
    .bind(params.postId ?? "")
    .first<{
      threadId: string;
      boardId: string;
      visibility: "public" | "private";
      boardVisibility: "public" | "private";
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
    const prior = await context.cloudflare.env.DB.prepare(
      "SELECT activity_id AS activityId FROM post_reactions WHERE post_id = ? AND actor_id = ? AND emoji = ?",
    )
      .bind(params.postId ?? "", session.user.id, emoji)
      .first<{ activityId: string | null }>();
    const result = await toggleReaction(context.cloudflare.env.DB, {
      postId: params.postId ?? "",
      actorId: session.user.id,
      emoji,
    });
    if (
      post.origin === "local" &&
      post.visibility === "public" &&
      post.boardVisibility === "public" &&
      post.objectUri
    ) {
      const actor = await context.cloudflare.env.DB.prepare(
        "SELECT handle FROM profiles WHERE user_id = ?",
      )
        .bind(session.user.id)
        .first<{ handle: string }>();
      if (actor) {
        const activityId = prior?.activityId ?? crypto.randomUUID();
        if (result === "added") {
          await context.cloudflare.env.DB.prepare(
            "UPDATE post_reactions SET activity_id = ? WHERE post_id = ? AND actor_id = ? AND emoji = ?",
          )
            .bind(activityId, params.postId ?? "", session.user.id, emoji)
            .run();
        }
        const activity =
          result === "removed"
            ? createUndoEmojiReactActivity({
                origin: context.cloudflare.env.APP_ORIGIN,
                actorHandle: actor.handle,
                activityId,
                objectUri: post.objectUri,
                emoji,
              })
            : createEmojiReactActivity({
                origin: context.cloudflare.env.APP_ORIGIN,
                actorHandle: actor.handle,
                activityId,
                objectUri: post.objectUri,
                emoji,
              });
        const now = new Date().toISOString();
        await context.cloudflare.env.DB.prepare(
          "INSERT INTO federation_outbox_events (id, actor_id, aggregate_type, aggregate_id, activity_type, activity_json, delivery_scope, state, queued_at, created_at, updated_at) VALUES (?, ?, 'reaction', ?, ?, ?, 'followers', 'pending', NULL, ?, ?)",
        )
          .bind(
            crypto.randomUUID(),
            session.user.id,
            params.postId ?? "",
            result === "removed" ? "Undo" : "EmojiReact",
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
