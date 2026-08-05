import { redirect } from "react-router";
import type { Route } from "./+types/posts.$postId.boost";
import { requireVerifiedSession } from "@/modules/identity/auth.server";
import { isSafeQuoteUri } from "@/modules/forum/p2";
import {
  createAnnounceActivity,
  createUndoAnnounceActivity,
} from "@/modules/federation/outbox";

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await requireVerifiedSession(
    request,
    context.cloudflare.env,
  ).catch((error) => {
    if (error instanceof Response && error.status === 401) {
      throw redirect("/auth/login");
    }
    throw error;
  });
  const post = await context.cloudflare.env.DB.prepare(
    "SELECT posts.thread_id AS threadId, federation_object_id AS objectUri, posts.visibility, boards.visibility AS boardVisibility FROM posts INNER JOIN threads ON threads.id = posts.thread_id INNER JOIN boards ON boards.id = threads.board_id WHERE posts.id = ? AND posts.state = 'published'",
  )
    .bind(params.postId ?? "")
    .first<{
      threadId: string;
      objectUri: string | null;
      visibility: string;
      boardVisibility: "public" | "private";
    }>();
  if (
    !post ||
    post.visibility !== "public" ||
    post.boardVisibility !== "public" ||
    !post.objectUri ||
    !isSafeQuoteUri(post.objectUri)
  )
    throw new Response("Not found", { status: 404 });
  const existing = await context.cloudflare.env.DB.prepare(
    "SELECT id, revoked_at AS revokedAt FROM post_boosts WHERE actor_id = ? AND target_uri = ? LIMIT 1",
  )
    .bind(session.user.id, post.objectUri)
    .first<{ id: string; revokedAt: string | null }>();
  const now = new Date().toISOString();
  const actor = await context.cloudflare.env.DB.prepare(
    "SELECT handle FROM profiles WHERE user_id = ?",
  )
    .bind(session.user.id)
    .first<{ handle: string }>();
  if (!actor) throw new Response("Actor unavailable", { status: 409 });
  const activityId = crypto.randomUUID();
  if (existing) {
    const revoking = !existing.revokedAt;
    await context.cloudflare.env.DB.prepare(
      "UPDATE post_boosts SET revoked_at = ? WHERE id = ?",
    )
      .bind(revoking ? now : null, existing.id)
      .run();
    const activity = revoking
      ? createUndoAnnounceActivity({
          origin: context.cloudflare.env.APP_ORIGIN,
          actorHandle: actor.handle,
          activityId,
          objectUri: post.objectUri,
        })
      : createAnnounceActivity({
          origin: context.cloudflare.env.APP_ORIGIN,
          actorHandle: actor.handle,
          activityId,
          objectUri: post.objectUri,
        });
    await context.cloudflare.env.DB.prepare(
      "INSERT INTO federation_outbox_events (id, actor_id, aggregate_type, aggregate_id, activity_type, activity_json, delivery_scope, state, queued_at, created_at, updated_at) VALUES (?, ?, 'boost', ?, ?, ?, 'followers', 'pending', NULL, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        session.user.id,
        params.postId ?? "",
        revoking ? "Undo" : "Announce",
        JSON.stringify(activity),
        now,
        now,
      )
      .run();
  } else {
    await context.cloudflare.env.DB.prepare(
      "INSERT INTO post_boosts (id, post_id, actor_id, target_uri, activity_id, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
    )
      .bind(
        crypto.randomUUID(),
        params.postId ?? "",
        session.user.id,
        post.objectUri,
        activityId,
        now,
      )
      .run();
    const activity = createAnnounceActivity({
      origin: context.cloudflare.env.APP_ORIGIN,
      actorHandle: actor.handle,
      activityId,
      objectUri: post.objectUri,
    });
    await context.cloudflare.env.DB.prepare(
      "INSERT INTO federation_outbox_events (id, actor_id, aggregate_type, aggregate_id, activity_type, activity_json, delivery_scope, state, queued_at, created_at, updated_at) VALUES (?, ?, 'boost', ?, 'Announce', ?, 'followers', 'pending', NULL, ?, ?)",
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
  return redirect(`/threads/${post.threadId}#post-${params.postId}`);
}
