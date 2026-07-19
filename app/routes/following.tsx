import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/following";
import { listFollowedRemoteNotes } from "@/modules/federation/remote-note";
import { getSession } from "@/modules/identity/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const notes = await listFollowedRemoteNotes(
    context.cloudflare.env.DB,
    session.user.id,
  );
  return { notes: notes.results };
}

export default function Following({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">来自已关注账号的公开内容</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            我的关注
          </h1>
        </div>
        <div className="flex gap-4 text-sm">
          <Link
            className="text-blue-700 hover:underline"
            to="/settings/actor-preferences"
          >
            管理已隐藏账号
          </Link>
          <Link className="text-blue-700 hover:underline" to="/">
            返回论坛
          </Link>
        </div>
      </div>
      {loaderData.notes.length > 0 ? (
        <ol className="mt-8 space-y-5">
          {loaderData.notes.map((note) => (
            <li key={note.uri} className="rounded-lg border p-5">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                <a
                  className="hover:text-blue-700 hover:underline"
                  href={note.actorUri}
                >
                  {note.actorName || note.actorUri}
                </a>
                <time dateTime={note.publishedAt}>
                  {note.publishedAt.slice(0, 16).replace("T", " ")}
                </time>
              </p>
              <article
                className="prose prose-slate mt-4 max-w-none"
                dangerouslySetInnerHTML={{ __html: note.contentHtml }}
              />
              <a
                className="mt-4 inline-block text-xs text-slate-500 hover:text-blue-700 hover:underline"
                href={note.uri}
              >
                查看原文
              </a>
              <Form method="post" action="/settings/actor-preferences">
                <input type="hidden" name="intent" value="set" />
                <input type="hidden" name="actorId" value={note.actorId} />
                <label className="sr-only" htmlFor={`preference-${note.uri}`}>
                  管理账号
                </label>
                <select
                  id={`preference-${note.uri}`}
                  name="state"
                  defaultValue="muted"
                  className="ml-4 rounded-md border px-2 py-1 text-xs"
                >
                  <option value="muted">静音账号</option>
                  <option value="blocked">屏蔽账号</option>
                </select>
                <button className="ml-2 text-xs text-slate-500 hover:text-blue-700 hover:underline">
                  保存
                </button>
              </Form>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-10 rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
          尚未收到已关注账号的公开动态。
        </p>
      )}
    </main>
  );
}
