import { data, redirect } from "react-router";
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
  try {
    if (String(form.get("intent")) === "move") {
      await moveBookmark(context.cloudflare.env.DB, {
        userId: session.user.id,
        folderId: String(form.get("folderId")),
        postId: String(form.get("postId")),
        add: String(form.get("add")) !== "false",
      });
      return { ok: true };
    }
    return {
      folder: await createBookmarkFolder(
        context.cloudflare.env.DB,
        session.user.id,
        String(form.get("name") ?? ""),
      ),
    };
  } catch (error) {
    return data(
      { error: error instanceof Error ? error.message : "操作失败。" },
      { status: 400 },
    );
  }
}

export default function BookmarkFolders() {
  return null;
}
