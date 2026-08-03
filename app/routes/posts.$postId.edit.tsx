import { data, Form, redirect, useActionData } from "react-router";

import type { Route } from "./+types/posts.$postId.edit";
import { MarkdownEditor } from "@/components/markdown-editor";
import {
  canViewForumBoard,
  canViewPrivateForumContent,
} from "@/modules/forum/access.server";
import { validateReplyInput, validateThreadInput } from "@/modules/forum/input";
import {
  editLocalPost,
  loadMutableForumPost,
} from "@/modules/forum/posts/lifecycle";
import { canManageLocalPost } from "@/modules/forum/posts/ownership";
import { loadForumBoard } from "@/modules/forum/read.server";
import { getSession } from "@/modules/identity/auth.server";
import {
  loadPostAttachments,
  mediaObjectPublicUrl,
  replacePostAttachments,
  validateAttachmentIds,
} from "@/modules/media";
import { authorizeDatabase } from "@/modules/permissions/authorization.server";

async function editablePostData(request: Request, env: Env, postId: string) {
  const session = await getSession(request, env);
  if (!session) throw redirect("/auth/login");
  const post = await loadMutableForumPost(env.DB, postId);
  if (!post) throw new Response("Not found", { status: 404 });
  const board = await loadForumBoard(env.DB, post.boardId);
  if (!board) throw new Response("Not found", { status: 404 });
  const [canView, canViewPrivate, editAny] = await Promise.all([
    canViewForumBoard(env.DB, board, session.user.id),
    canViewPrivateForumContent(env.DB, board, session.user.id),
    authorizeDatabase(env.DB, {
      userId: session.user.id,
      permission: "posts.edit_any",
      boardId: board.id,
    }),
  ]);
  if (!canView || (post.visibility === "private" && !canViewPrivate)) {
    throw new Response("Not found", { status: 404 });
  }
  if (!canManageLocalPost(post, session.user.id, editAny.allowed)) {
    throw new Response("Forbidden", { status: 403 });
  }
  const attachmentMap = await loadPostAttachments(env.DB, [post.id]);
  const attachments = (attachmentMap.get(post.id) ?? []).map((item) => ({
    id: item.id,
    url: mediaObjectPublicUrl(env.APP_ORIGIN, item.id),
    contentType: item.contentType,
    originalFilename: item.originalFilename,
    kind: item.kind,
    byteSize: item.byteSize,
  }));
  return {
    session,
    post,
    isFirstPost: post.id === post.firstPostId,
    attachments,
  };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  return editablePostData(request, context.cloudflare.env, params.postId ?? "");
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { post, isFirstPost } = await editablePostData(
    request,
    context.cloudflare.env,
    params.postId ?? "",
  );
  const form = await request.formData();
  const attachments = validateAttachmentIds(form.getAll("attachmentIds"));
  if (!attachments.ok)
    return data({ error: attachments.message }, { status: 400 });
  const linked = await replacePostAttachments(context.cloudflare.env.DB, {
    postId: post.id,
    authorUserId: post.authorUserId!,
    attachmentIds: attachments.ids,
  });
  if (!linked.ok) return data({ error: linked.message }, { status: 400 });
  let markdown: string;
  let title: string | undefined;
  if (isFirstPost) {
    const input = validateThreadInput({
      title: String(form.get("title") ?? ""),
      markdown: String(form.get("markdown") ?? ""),
    });
    if (!input.ok) return data({ error: input.message }, { status: 400 });
    title = input.value.title;
    markdown = input.value.markdown;
  } else {
    const input = validateReplyInput({
      markdown: String(form.get("markdown") ?? ""),
    });
    if (!input.ok) return data({ error: input.message }, { status: 400 });
    markdown = input.value.markdown;
  }
  await editLocalPost(context.cloudflare.env.DB, {
    postId: post.id,
    threadId: post.threadId,
    firstPostId: post.firstPostId,
    authorUserId: post.authorUserId!,
    markdown,
    ...(title !== undefined ? { title } : {}),
    visibility: post.visibility,
    publishedAt: post.publishedAt,
    parentPostId: post.parentPostId,
    revisionId: crypto.randomUUID(),
    attachmentIds: attachments.ids,
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
  return redirect(`/threads/${post.threadId}#post-${post.id}`);
}

export default function EditPost({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const { post, isFirstPost, attachments } = loaderData;
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        编辑{isFirstPost ? "主题" : "回复"}
      </h1>
      {actionData?.error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {actionData.error}
        </p>
      ) : null}
      <Form method="post" className="mt-8 grid gap-4">
        {isFirstPost ? (
          <label className="grid gap-1 text-sm font-medium">
            标题
            <input
              required
              name="title"
              defaultValue={post.threadTitle}
              maxLength={200}
              className="rounded-md border px-3 py-2 font-normal"
            />
          </label>
        ) : null}
        <MarkdownEditor
          defaultValue={post.markdown}
          initialAttachments={attachments}
          rows={12}
        />
        <div className="flex gap-4">
          <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            保存修改
          </button>
          <a
            href={`/threads/${post.threadId}#post-${post.id}`}
            className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50"
          >
            取消
          </a>
        </div>
      </Form>
    </main>
  );
}
