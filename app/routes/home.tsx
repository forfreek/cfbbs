import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import CircleDot from "lucide-react/dist/esm/icons/circle-dot.mjs";
import Folder from "lucide-react/dist/esm/icons/folder.mjs";
import HomeIcon from "lucide-react/dist/esm/icons/home.mjs";
import PenLine from "lucide-react/dist/esm/icons/pen-line.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.mjs";
import { Form, Link } from "react-router";

import type { Route } from "./+types/home";
import {
  boardGroups,
  loadPublicHome,
  parseHomeSort,
  type HomeBoard,
} from "@/modules/forum/home/service";
import { getSession } from "@/modules/identity/auth.server";

function BoardGroup({
  board,
  items,
}: {
  board: HomeBoard;
  items: Array<HomeBoard & { depth: number }>;
}) {
  return (
    <section className="mt-5">
      <h2 className="flex items-center gap-1 text-sm font-semibold">
        <ChevronDown className="size-3.5" />
        {board.title}
      </h2>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
              to={`/boards/${item.id}`}
              style={{ paddingLeft: `${0.5 + item.depth * 0.75}rem` }}
            >
              <Folder className="size-3.5" />
              {item.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function meta() {
  return [
    { title: "CFBBS" },
    { name: "description", content: "联邦化的现代论坛" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const requestUrl = new URL(request.url);
  const sort = parseHomeSort(requestUrl.searchParams.get("sort"));
  const [home, session] = await Promise.all([
    loadPublicHome(context.cloudflare.env.DB, sort),
    getSession(request, context.cloudflare.env),
  ]);
  return { ...home, session, sort };
}

function formatActivityTime(value: string) {
  return value.slice(0, 16).replace("T", " ");
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const groups = boardGroups(loaderData.boards);
  const activity = loaderData.topics.slice(0, 5);
  const session = loaderData.session;
  const postingBoard = loaderData.boards.find(
    (board) => board.mode === "posting",
  );
  const sortOptions = [
    { value: "latest", label: "最新" },
    { value: "active", label: "活跃" },
    { value: "unreplied", label: "未回复" },
  ] as const;
  const publishTarget = session
    ? postingBoard
      ? `/boards/${postingBoard.id}#create-thread`
      : "/"
    : "/auth/register";

  return (
    <main id="main-content" className="min-h-screen bg-white text-slate-900">
      <a
        className="sr-only absolute top-3 left-4 z-20 rounded bg-blue-700 px-3 py-2 text-sm text-white focus:not-sr-only"
        href="#main-content"
      >
        跳到主要内容
      </a>
      <header className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center px-5">
          <Link
            to="/"
            className="mr-12 text-2xl font-bold tracking-tight text-blue-700"
          >
            CFBBS
          </Link>
          <nav className="hidden h-full items-center gap-7 text-sm sm:flex">
            <Link
              className="flex h-full items-center border-b-2 border-blue-600 font-medium text-blue-700"
              to="/"
            >
              Boards
            </Link>
            <Link
              className="text-slate-600 hover:text-slate-950"
              to="/following"
            >
              Following
            </Link>
            <Link
              className="flex items-center gap-1.5 text-slate-600 hover:text-slate-950"
              to="/search"
            >
              <Search className="size-4" />
              Search
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-4 text-sm">
            {session ? (
              <>
                <Link className="hidden sm:block" to="/notifications">
                  通知
                </Link>
                <Link
                  className="hidden sm:block"
                  to={`/users/${session.user.username}`}
                >
                  @{session.user.username}
                </Link>
                <Form method="post" action="/auth/logout">
                  <button className="rounded-md border px-3 py-1.5 hover:bg-slate-50">
                    退出
                  </button>
                </Form>
              </>
            ) : (
              <>
                <Link className="hidden sm:block" to="/auth/login">
                  Sign in
                </Link>
                <Link
                  className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white shadow-sm hover:bg-blue-700"
                  to="/auth/register"
                >
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)_280px]">
        <aside className="hidden border-r px-4 py-7 xl:block">
          <h2 className="px-2 text-sm font-semibold">导航</h2>
          <nav className="mt-2 space-y-1">
            <Link
              className="flex items-center gap-2 rounded-md bg-blue-50 px-2 py-2 text-sm font-medium text-blue-700"
              to="/"
            >
              <HomeIcon className="size-4" />
              全部主题
            </Link>
            <Link
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-600 hover:bg-slate-50"
              to="/following"
            >
              <CircleDot className="size-4" />
              我的关注
            </Link>
            <Link
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-600 hover:bg-slate-50"
              to="/?sort=active"
            >
              <Sparkles className="size-4" />
              热门主题
            </Link>
          </nav>
          <div className="my-5 border-t" />
          <h2 className="px-2 text-sm font-semibold">板块导航</h2>
          {groups.length > 0 ? (
            groups.map((group) => (
              <BoardGroup key={group.board.id} {...group} />
            ))
          ) : (
            <p className="px-2 py-5 text-sm text-slate-500">暂无公开板块。</p>
          )}
        </aside>
        <section className="min-w-0 px-7 py-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">全部主题</h1>
            <Link
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
              to={publishTarget}
            >
              <PenLine className="size-4" />
              发布主题
            </Link>
          </div>
          <nav
            className="mt-7 flex gap-6 border-b text-sm"
            aria-label="主题排序"
          >
            {sortOptions.map((option) => {
              const active = loaderData.sort === option.value;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "border-b-2 border-blue-600 pb-3 font-medium text-blue-700"
                      : "pb-3 text-slate-500 hover:text-slate-900"
                  }
                  key={option.value}
                  to={
                    option.value === "latest" ? "/" : `/?sort=${option.value}`
                  }
                >
                  {option.label}
                </Link>
              );
            })}
          </nav>
          <div className="grid grid-cols-[minmax(0,1fr)_80px_44px_80px] gap-3 border-b py-3 text-xs font-medium text-slate-500">
            <span>主题</span>
            <span>作者</span>
            <span>回复</span>
            <span>时间</span>
          </div>
          <div>
            {loaderData.topics.map((topic, index) => (
              <article
                key={topic.id}
                className="grid grid-cols-[minmax(0,1fr)_80px_44px_80px] gap-3 border-b py-4 text-sm"
              >
                <Link
                  className="truncate font-medium hover:text-blue-700"
                  to={`/threads/${topic.id}`}
                >
                  {topic.title}
                  {index === 0 ? (
                    <span className="ml-2 inline-block size-1.5 rounded-full bg-blue-600 align-middle" />
                  ) : null}
                </Link>
                <span className="truncate text-slate-500">
                  {topic.authorName}
                </span>
                <span className="text-slate-500">{topic.replyCount}</span>
                <span className="text-right text-slate-500">
                  {formatActivityTime(topic.activityAt)}
                </span>
              </article>
            ))}
            {loaderData.topics.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">
                还没有公开主题。登录后即可发布第一个主题。
              </p>
            ) : null}
          </div>
          {loaderData.topics.length >= 50 ? (
            <p className="mt-5 text-center text-sm text-slate-500">
              显示最近 50 个主题。
            </p>
          ) : null}
        </section>
        <aside className="hidden space-y-5 border-l bg-slate-50/30 px-5 py-8 xl:block">
          <section className="rounded-lg border bg-white p-5">
            <h2 className="text-lg font-semibold">关于联邦身份</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              CFBBS 基于开放的联邦协议构建，使用您的域名作为身份标识。
            </p>
            <div className="mt-5 space-y-4 text-sm">
              <p>
                <strong>自主掌控身份</strong>
                <br />
                <span className="text-slate-500">使用您的域名创建账号。</span>
              </p>
              <p>
                <strong>跨站关注与互动</strong>
                <br />
                <span className="text-slate-500">
                  关注其他站点的用户，参与跨站讨论。
                </span>
              </p>
              <p>
                <strong>开放与互通</strong>
                <br />
                <span className="text-slate-500">任何人都可以运行 CFBBS。</span>
              </p>
            </div>
          </section>
          <section className="rounded-lg border bg-white p-5">
            <h2 className="font-semibold">最近活动</h2>
            <ul className="mt-4 space-y-4">
              {activity.map((topic, index) => (
                <li key={topic.id} className="flex gap-2 text-sm">
                  <span
                    className={
                      [
                        "bg-emerald-500",
                        "bg-rose-500",
                        "bg-blue-500",
                        "bg-violet-500",
                        "bg-amber-500",
                      ][index] + " mt-1.5 size-2 shrink-0 rounded-full"
                    }
                  />
                  <span>
                    <span className="text-slate-600">
                      {topic.authorName} 发布了主题
                    </span>
                    <br />
                    <Link
                      className="line-clamp-1 text-blue-700 hover:underline"
                      to={`/threads/${topic.id}`}
                    >
                      {topic.title}
                    </Link>
                  </span>
                </li>
              ))}
              {activity.length === 0 ? (
                <li className="text-sm text-slate-500">暂无公开活动。</li>
              ) : null}
            </ul>
            <Link
              className="mt-5 flex items-center gap-1 text-sm font-medium text-blue-700"
              to="/?sort=active"
            >
              查看全部活动 <ChevronRight className="size-4" />
            </Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
