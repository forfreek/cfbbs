import { data, redirect } from "react-router";
import type { Route } from "./+types/posts.$postId.quote";
import { requireVerifiedSession } from "@/modules/identity/auth.server";
import { resolveQuoteTarget } from "@/modules/forum/quotes";

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
  const form = await request.formData();
  const targetUri = String(form.get("targetUri") ?? "");
  const targetPostId = String(form.get("targetPostId") ?? "").trim();
  const target = await resolveQuoteTarget(context.cloudflare.env.DB, {
    targetPostId: targetPostId || null,
    targetUri,
  });
  if (!target.ok) return data({ error: target.message }, { status: 400 });
  const source = await context.cloudflare.env.DB.prepare(
    "SELECT posts.thread_id AS threadId, posts.author_user_id AS authorUserId, boards.visibility AS boardVisibility, posts.visibility FROM posts INNER JOIN threads ON threads.id = posts.thread_id INNER JOIN boards ON boards.id = threads.board_id WHERE posts.id = ? AND state = 'published'",
  )
    .bind(params.postId ?? "")
    .first<{
      threadId: string;
      authorUserId: string | null;
      boardVisibility: "public" | "private";
      visibility: "public" | "private";
    }>();
  if (
    !source ||
    source.authorUserId !== session.user.id ||
    source.boardVisibility !== "public" ||
    source.visibility !== "public"
  )
    return new Response("Forbidden", { status: 403 });
  await context.cloudflare.env.DB.prepare(
    "INSERT OR IGNORE INTO post_quotes (id, post_id, target_post_id, target_uri, snapshot_html, snapshot_title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      params.postId ?? "",
      target.quote.targetPostId,
      target.quote.targetUri,
      target.quote.snapshotHtml,
      target.quote.snapshotTitle,
      new Date().toISOString(),
    )
    .run();
  return redirect(`/threads/${source.threadId}#post-${params.postId}`);
}
