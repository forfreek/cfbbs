import { redirect } from "react-router";
import type { Route } from "./+types/bookmarks.folders";
import { getSession } from "@/modules/identity/auth.server";
import {
  createBookmarkFolder,
  listBookmarkFolders,
  moveBookmark,
} from "@/modules/forum/p2";

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  return {
    folders: await listBookmarkFolders(
      context.cloudflare.env.DB,
      session.user.id,
    ),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const form = await request.formData();
  const returnToValue = String(form.get("returnTo") ?? "");
  const returnTo = returnToValue.startsWith("/bookmarks")
    ? returnToValue
    : "/bookmarks";
  try {
    if (String(form.get("intent")) === "move") {
      await moveBookmark(context.cloudflare.env.DB, {
        userId: session.user.id,
        folderId: String(form.get("folderId")),
        postId: String(form.get("postId")),
        add: String(form.get("add")) !== "false",
      });
      return redirect(returnTo);
    }
    if (String(form.get("intent")) === "rename") {
      const name = String(form.get("name") ?? "").trim();
      if (!name || name.length > 80)
        throw new Error("文件夹名称需要 1 到 80 个字符。");
      await context.cloudflare.env.DB.prepare(
        "UPDATE bookmark_folders SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      )
        .bind(
          name,
          new Date().toISOString(),
          String(form.get("folderId")),
          session.user.id,
        )
        .run();
      return redirect(returnTo);
    }
    if (String(form.get("intent")) === "delete") {
      const folderId = String(form.get("folderId"));
      await context.cloudflare.env.DB.batch([
        context.cloudflare.env.DB.prepare(
          "DELETE FROM bookmark_folder_items WHERE folder_id = ? AND user_id = ?",
        ).bind(folderId, session.user.id),
        context.cloudflare.env.DB.prepare(
          "DELETE FROM bookmark_folders WHERE id = ? AND user_id = ?",
        ).bind(folderId, session.user.id),
      ]);
      return redirect(returnTo);
    }
    await createBookmarkFolder(
      context.cloudflare.env.DB,
      session.user.id,
      String(form.get("name") ?? ""),
    );
    return redirect(returnTo);
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败。";
    const separator = returnTo.includes("?") ? "&" : "?";
    throw redirect(
      `${returnTo}${separator}error=${encodeURIComponent(message)}`,
    );
  }
}

export default function BookmarkFolders() {
  return null;
}
