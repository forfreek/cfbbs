import { data, redirect } from "react-router";
import type { Route } from "./+types/posts.$postId.quote";
import { getSession } from "@/modules/identity/auth.server";
import { isSafeQuoteUri } from "@/modules/forum/p2";

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const form = await request.formData();
  const targetUri = String(form.get("targetUri") ?? "");
  if (!isSafeQuoteUri(targetUri, context.cloudflare.env.APP_ORIGIN))
    return data({ error: "引用地址必须是安全 HTTPS 地址。" }, { status: 400 });
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
    "INSERT OR IGNORE INTO post_quotes (id, post_id, target_post_id, target_uri, snapshot_html, snapshot_title, created_at) VALUES (?, ?, NULL, ?, NULL, NULL, ?)",
  )
    .bind(
      crypto.randomUUID(),
      params.postId ?? "",
      targetUri,
      new Date().toISOString(),
    )
    .run();
  return redirect(`/threads/${source.threadId}#post-${params.postId}`);
}
