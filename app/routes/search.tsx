import SearchIcon from "lucide-react/dist/esm/icons/search.mjs";
import { Form, Link, data, redirect, useActionData } from "react-router";

import type { Route } from "./+types/search";
import { createOutboundFollow } from "@/modules/federation/follows";
import {
  lookupRemoteResource,
  parseRemoteLookupTarget,
  resolveRemoteActorForFollow,
} from "@/modules/federation/remote-lookup";
import { searchLocalPosts } from "@/modules/forum/search/service";
import { getSession } from "@/modules/identity/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const session = await getSession(request, context.cloudflare.env);
  const remoteTarget = parseRemoteLookupTarget(query);
  if (remoteTarget) {
    try {
      const remoteLookup = await lookupRemoteResource(remoteTarget);
      return {
        query,
        results: [],
        remoteLookup,
        remoteLookupError: null,
        session,
      };
    } catch {
      return {
        query,
        results: [],
        remoteLookup: null,
        remoteLookupError: "无法获取这个远端 ActivityPub 资源。",
        session,
      };
    }
  }
  const results = await searchLocalPosts(context.cloudflare.env.DB, query);
  return {
    query,
    results,
    remoteLookup: null,
    remoteLookupError: null,
    session,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const query = String(form.get("q") ?? "");
  if (intent !== "follow-remote") {
    return data({ error: "未知操作。" }, { status: 400 });
  }

  const remoteTarget = parseRemoteLookupTarget(query);
  if (!remoteTarget) {
    return data(
      { error: "请提供完整的远端 handle 或 HTTPS Actor URL。" },
      { status: 400 },
    );
  }

  const username =
    typeof session.user.username === "string" ? session.user.username : null;
  if (!username) {
    return data({ error: "当前登录账号缺少用户名。" }, { status: 400 });
  }

  try {
    const following = await resolveRemoteActorForFollow(remoteTarget);
    await createOutboundFollow(context.cloudflare.env.DB, {
      eventId: crypto.randomUUID(),
      localActorId: session.user.id,
      localHandle: username,
      origin: context.cloudflare.env.APP_ORIGIN,
      following,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "关注远端账号失败。";
    return data({ error: message }, { status: 400 });
  }

  return redirect(`/search?q=${encodeURIComponent(query)}`);
}

export default function SearchPage({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const searched = loaderData.query.trim().length > 0;
  const canFollowRemote =
    loaderData.session !== null && loaderData.remoteLookup?.kind === "actor";
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">
            检索公开的本地内容，或查询完整的远端 handle / HTTPS URL
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">搜索</h1>
        </div>
        <Link className="text-sm text-blue-700 hover:underline" to="/">
          返回论坛
        </Link>
      </div>
      <Form method="get" className="mt-8 flex gap-3">
        <label className="sr-only" htmlFor="search-query">
          搜索关键词
        </label>
        <input
          id="search-query"
          name="q"
          defaultValue={loaderData.query}
          maxLength={200}
          placeholder="搜索主题或回复"
          className="min-w-0 flex-1 rounded-md border px-3 py-2"
        />
        <button className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <SearchIcon className="size-4" />
          搜索
        </button>
      </Form>
      {actionData?.error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {actionData.error}
        </p>
      ) : null}
      {loaderData.remoteLookup ? (
        <section className="mt-8 rounded-lg border p-5" aria-live="polite">
          <p className="text-sm text-slate-500">远端 ActivityPub 资源</p>
          <h2 className="mt-1 text-lg font-semibold">
            {loaderData.remoteLookup.name}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {loaderData.remoteLookup.kind === "actor" ? "账号" : "对象"} ·{" "}
            {loaderData.remoteLookup.type}
          </p>
          <a
            className="mt-3 inline-block text-sm text-blue-700 hover:underline"
            href={loaderData.remoteLookup.url}
            rel="noreferrer noopener"
            target="_blank"
          >
            在远端打开
          </a>
          {canFollowRemote ? (
            <Form method="post" className="mt-4">
              <input type="hidden" name="intent" value="follow-remote" />
              <input type="hidden" name="q" value={loaderData.query} />
              <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                关注此账号
              </button>
            </Form>
          ) : null}
        </section>
      ) : loaderData.remoteLookupError ? (
        <p role="alert" className="mt-8 text-sm text-amber-700">
          {loaderData.remoteLookupError}
        </p>
      ) : searched ? (
        <section className="mt-8" aria-live="polite">
          <h2 className="text-sm text-slate-500">
            {loaderData.results.length > 0
              ? `找到 ${loaderData.results.length} 条结果`
              : "没有匹配的公开内容"}
          </h2>
          <ol className="mt-4 divide-y border-y">
            {loaderData.results.map((result) => (
              <li key={result.postId} className="py-4">
                <Link
                  className="font-medium text-slate-900 hover:text-blue-700 hover:underline"
                  to={`/threads/${result.threadId}#post-${result.postId}`}
                >
                  {result.title}
                </Link>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                  {result.excerpt}
                </p>
                <time
                  className="mt-2 block text-xs text-slate-500"
                  dateTime={result.publishedAt}
                >
                  {result.publishedAt.slice(0, 16).replace("T", " ")}
                </time>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="mt-8 text-sm text-slate-500">
          输入关键词以查找公开的本地讨论。
        </p>
      )}
    </main>
  );
}
