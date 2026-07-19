import { redirect } from "react-router";

import type { Route } from "./+types/posts.$postId.delete";
import {
  canViewForumBoard,
  canViewPrivateForumContent,
} from "@/modules/forum/access.server";
import {
  loadMutableForumPost,
  softDeleteLocalPost,
} from "@/modules/forum/posts/lifecycle";
import { canManageLocalPost } from "@/modules/forum/posts/ownership";
import { loadForumBoard } from "@/modules/forum/read.server";
import { getSession } from "@/modules/identity/auth.server";
import { authorizeDatabase } from "@/modules/permissions/authorization.server";

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const post = await loadMutableForumPost(
    context.cloudflare.env.DB,
    params.postId ?? "",
  );
  if (!post) throw new Response("Not found", { status: 404 });
  const board = await loadForumBoard(context.cloudflare.env.DB, post.boardId);
  if (!board) throw new Response("Not found", { status: 404 });
  const [canView, canViewPrivate, deleteAny] = await Promise.all([
    canViewForumBoard(context.cloudflare.env.DB, board, session.user.id),
    canViewPrivateForumContent(
      context.cloudflare.env.DB,
      board,
      session.user.id,
    ),
    authorizeDatabase(context.cloudflare.env.DB, {
      userId: session.user.id,
      permission: "posts.delete_any",
      boardId: board.id,
    }),
  ]);
  if (!canView || (post.visibility === "private" && !canViewPrivate)) {
    throw new Response("Not found", { status: 404 });
  }
  if (!canManageLocalPost(post, session.user.id, deleteAny.allowed)) {
    throw new Response("Forbidden", { status: 403 });
  }
  await softDeleteLocalPost(context.cloudflare.env.DB, {
    postId: post.id,
    threadId: post.threadId,
    authorUserId: post.authorUserId!,
    visibility: post.visibility,
    ...(post.visibility === "public"
      ? {
          federation: {
            eventId: crypto.randomUUID(),
            actorId: post.authorUserId!,
            origin: context.cloudflare.env.APP_ORIGIN,
          },
        }
      : {}),
  });
  return redirect(
    post.id === post.firstPostId
      ? `/boards/${post.boardId}`
      : `/threads/${post.threadId}`,
  );
}
