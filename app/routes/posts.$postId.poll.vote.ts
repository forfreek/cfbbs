import { data, redirect } from "react-router";
import type { Route } from "./+types/posts.$postId.poll.vote";
import { getSession } from "@/modules/identity/auth.server";
import { voteInPoll } from "@/modules/forum/p2";

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const origin = await context.cloudflare.env.DB.prepare(
    "SELECT origin FROM posts WHERE id = ? AND state = 'published'",
  )
    .bind(params.postId ?? "")
    .first<{ origin: "local" | "remote" }>();
  if (!origin) return data({ error: "帖子不存在。" }, { status: 404 });
  if (origin.origin !== "local")
    return data({ error: "远端投票仅支持只读展示。" }, { status: 403 });
  const form = await request.formData();
  const optionIds = form.getAll("optionIds").map(String);
  try {
    await voteInPoll(context.cloudflare.env.DB, {
      postId: params.postId ?? "",
      userId: session.user.id,
      optionIds,
    });
  } catch (error) {
    return data(
      { error: error instanceof Error ? error.message : "投票失败。" },
      { status: 400 },
    );
  }
  const post = await context.cloudflare.env.DB.prepare(
    "SELECT thread_id AS threadId FROM posts WHERE id = ?",
  )
    .bind(params.postId ?? "")
    .first<{ threadId: string }>();
  return redirect(
    post ? `/threads/${post.threadId}#post-${params.postId}` : "/",
  );
}
