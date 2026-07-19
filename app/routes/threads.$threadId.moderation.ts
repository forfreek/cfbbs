import { redirect } from "react-router";

import type { Route } from "./+types/threads.$threadId.moderation";
import { canViewForumBoard } from "@/modules/forum/access.server";
import { loadForumBoard, loadForumThread } from "@/modules/forum/read.server";
import {
  setThreadLocked,
  setThreadPinned,
} from "@/modules/forum/threads/moderation";
import { getSession } from "@/modules/identity/auth.server";
import { authorizeDatabase } from "@/modules/permissions/authorization.server";

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const thread = await loadForumThread(
    context.cloudflare.env.DB,
    params.threadId ?? "",
  );
  if (!thread) throw new Response("Not found", { status: 404 });
  const board = await loadForumBoard(context.cloudflare.env.DB, thread.boardId);
  if (!board) throw new Response("Not found", { status: 404 });
  if (
    !(await canViewForumBoard(
      context.cloudflare.env.DB,
      board,
      session.user.id,
    ))
  ) {
    throw new Response("Not found", { status: 404 });
  }
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const audit = {
    threadId: thread.id,
    actorUserId: session.user.id,
    auditId: crypto.randomUUID(),
  };
  if (intent === "lock" || intent === "unlock") {
    const decision = await authorizeDatabase(context.cloudflare.env.DB, {
      userId: session.user.id,
      permission: "threads.lock",
      boardId: board.id,
    });
    if (!decision.allowed) throw new Response("Forbidden", { status: 403 });
    await setThreadLocked(context.cloudflare.env.DB, {
      ...audit,
      locked: intent === "lock",
    });
  } else if (intent === "pin" || intent === "unpin") {
    const decision = await authorizeDatabase(context.cloudflare.env.DB, {
      userId: session.user.id,
      permission: "threads.pin",
      boardId: board.id,
    });
    if (!decision.allowed) throw new Response("Forbidden", { status: 403 });
    await setThreadPinned(context.cloudflare.env.DB, {
      ...audit,
      pinned: intent === "pin",
    });
  } else {
    throw new Response("Bad request", { status: 400 });
  }
  return redirect(`/threads/${thread.id}`);
}
