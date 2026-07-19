import { redirect } from "react-router";

import type { Route } from "./+types/posts.$postId.like";
import {
  canViewForumBoard,
  canViewPrivateForumContent,
} from "@/modules/forum/access.server";
import { createNotification } from "@/modules/forum/notifications/service";
import { loadForumBoard } from "@/modules/forum/read.server";
import { togglePostLike } from "@/modules/forum/posts/likes";
import { toggleOutboundLike } from "@/modules/federation/likes";
import { getSession } from "@/modules/identity/auth.server";

type LikeablePost = {
  id: string;
  threadId: string;
  boardId: string;
  authorUserId: string | null;
  authorActorId: string | null;
  federationObjectId: string | null;
  origin: "local" | "remote";
  visibility: "public" | "private";
};

type RemoteLikeDelivery = {
  uri: string;
  inboxUrl: string;
  sharedInboxUrl: string | null;
};

async function loadLikeablePost(database: D1Database, postId: string) {
  return database
    .prepare(
      "SELECT posts.id, posts.thread_id AS threadId, threads.board_id AS boardId, posts.author_user_id AS authorUserId, posts.author_actor_id AS authorActorId, posts.federation_object_id AS federationObjectId, posts.origin, posts.visibility FROM posts INNER JOIN threads ON threads.id = posts.thread_id WHERE posts.id = ? AND posts.state = 'published'",
    )
    .bind(postId)
    .first<LikeablePost>();
}

async function loadRemoteLikeDelivery(database: D1Database, actorId: string) {
  return database
    .prepare(
      "SELECT uri, inbox_url AS inboxUrl, shared_inbox_url AS sharedInboxUrl FROM federation_actors WHERE id = ? AND is_local = 0 AND blocked_at IS NULL LIMIT 1",
    )
    .bind(actorId)
    .first<RemoteLikeDelivery>();
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

  const result =
    post.origin === "remote"
      ? await toggleRemotePostLike(
          context.cloudflare.env.DB,
          post,
          session.user,
          context.cloudflare.env.APP_ORIGIN,
        )
      : await togglePostLike(
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

async function toggleRemotePostLike(
  database: D1Database,
  post: LikeablePost,
  user: { id: string; username?: string | null },
  origin: string,
) {
  if (!post.authorActorId || !post.federationObjectId || !user.username) {
    throw new Response("Remote post is not federation-ready", { status: 409 });
  }
  const remoteActor = await loadRemoteLikeDelivery(
    database,
    post.authorActorId,
  );
  if (!remoteActor) {
    throw new Response("Remote actor is unavailable", { status: 409 });
  }
  return toggleOutboundLike(database, {
    eventId: crypto.randomUUID(),
    localActorId: user.id,
    localHandle: user.username,
    origin,
    postId: post.id,
    objectUri: post.federationObjectId,
    remoteActorUri: remoteActor.uri,
    inboxUrl: remoteActor.inboxUrl,
    sharedInboxUrl: remoteActor.sharedInboxUrl,
  });
}
