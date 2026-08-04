import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import CircleDot from "lucide-react/dist/esm/icons/circle-dot.mjs";
import Flame from "lucide-react/dist/esm/icons/flame.mjs";
import Folder from "lucide-react/dist/esm/icons/folder.mjs";
import HomeIcon from "lucide-react/dist/esm/icons/home.mjs";
import MessageCircle from "lucide-react/dist/esm/icons/message-circle.mjs";
import PenLine from "lucide-react/dist/esm/icons/pen-line.mjs";
import Tag from "lucide-react/dist/esm/icons/tag.mjs";
import UsersRound from "lucide-react/dist/esm/icons/users-round.mjs";
import { Link } from "react-router";

import type { Route } from "./+types/home";
import {
  boardGroups,
  decodeHomeCursor,
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
    <section className="sidebar-section">
      <h2 className="sidebar-section__title">
        <ChevronDown aria-hidden="true" />
        {board.title}
      </h2>
      <ul className="sidebar-list">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              className="sidebar-link sidebar-link--nested"
              to={`/boards/${item.id}`}
              style={{ paddingLeft: `${0.75 + item.depth * 0.75}rem` }}
            >
              <Folder aria-hidden="true" />
              <span>{item.title}</span>
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
  const cursorValue = requestUrl.searchParams.get("cursor");
  const cursor = decodeHomeCursor(cursorValue, sort);
  if (cursorValue !== null && !cursor)
    throw new Response("Invalid cursor", { status: 400 });
  let userSession = null;
  try {
    userSession = await getSession(request, context.cloudflare.env);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("BETTER_AUTH_SECRET")
    ) {
      throw error;
    }
  }
  const home = await loadPublicHome(context.cloudflare.env.DB, sort, cursor);
  return { ...home, session: userSession, sort };
}

function formatActivityTime(value: string) {
  return value.slice(0, 16).replace("T", " ");
}

function initials(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "?";
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const groups = boardGroups(loaderData.boards);
  const activity = loaderData.topics.slice(0, 5);
  const session = loaderData.session;
  const postingBoard = loaderData.boards.find(
    (board) => board.mode === "posting",
  );
  const sortOptions = [
    { value: "latest", label: "最新回复" },
    { value: "active", label: "最活跃" },
    { value: "unreplied", label: "未回复" },
  ] as const;
  const publishTarget = session
    ? postingBoard
      ? `/boards/${postingBoard.id}#create-thread`
      : "/"
    : "/auth/register";

  return (
    <main id="main-content" className="forum-page">
      <div className="forum-layout">
        <aside className="forum-sidebar" aria-label="论坛导航">
          <Link className="primary-button sidebar-compose" to={publishTarget}>
            <PenLine aria-hidden="true" />
            发布讨论
          </Link>
          <nav className="sidebar-nav" aria-label="内容导航">
            <Link className="sidebar-link sidebar-link--active" to="/">
              <HomeIcon aria-hidden="true" />
              <span>全部讨论</span>
            </Link>
            <Link className="sidebar-link" to="/following">
              <CircleDot aria-hidden="true" />
              <span>我关注的</span>
            </Link>
            <Link className="sidebar-link" to="/notifications">
              <MessageCircle aria-hidden="true" />
              <span>我的通知</span>
            </Link>
            <Link className="sidebar-link" to="/bookmarks">
              <MessageCircle aria-hidden="true" />
              <span>我的收藏</span>
            </Link>
            <Link className="sidebar-link" to="/search">
              <Tag aria-hidden="true" />
              <span>搜索主题</span>
            </Link>
          </nav>
          <div className="sidebar-divider" />
          {groups.length > 0 ? (
            groups.map((group) => (
              <BoardGroup key={group.board.id} {...group} />
            ))
          ) : (
            <p className="sidebar-empty">暂无公开板块。</p>
          )}
          <div className="sidebar-footer">
            <UsersRound aria-hidden="true" />
            <span>开放的联邦社区</span>
          </div>
        </aside>

        <section className="forum-main" aria-labelledby="topic-list-title">
          <div className="forum-main__header">
            <div>
              <p className="eyebrow">社区讨论</p>
              <h1 id="topic-list-title">全部讨论</h1>
            </div>
            <Link
              className="primary-button primary-button--small"
              to={publishTarget}
            >
              <PenLine aria-hidden="true" />
              发布主题
            </Link>
          </div>
          <nav className="topic-tabs" aria-label="主题排序">
            {sortOptions.map((option) => {
              const active = loaderData.sort === option.value;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={
                    active ? "topic-tab topic-tab--active" : "topic-tab"
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
          <div className="topic-list">
            {loaderData.topics.map((topic, index) => (
              <article className="topic-row" key={topic.id}>
                <span
                  className={`avatar avatar--${index % 3}`}
                  aria-hidden="true"
                >
                  {initials(topic.authorName)}
                </span>
                <div className="topic-row__content">
                  <Link
                    className="topic-row__title"
                    to={`/threads/${topic.id}`}
                  >
                    {topic.title}
                    {index === 0 ? (
                      <span className="topic-row__dot" aria-label="有新回复" />
                    ) : null}
                  </Link>
                  <p className="topic-row__meta">
                    <span>{topic.authorName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatActivityTime(topic.activityAt)}</span>
                  </p>
                </div>
                <div className="topic-row__stats">
                  <span title="回复数">
                    <MessageCircle aria-hidden="true" />
                    {topic.replyCount}
                  </span>
                </div>
              </article>
            ))}
            {loaderData.topics.length === 0 ? (
              <p className="empty-state">
                还没有公开主题。登录后即可发布第一个主题。
              </p>
            ) : null}
          </div>
          {loaderData.nextCursor ? (
            <Link
              className="list-note"
              to={`/?sort=${loaderData.sort}&cursor=${loaderData.nextCursor}`}
            >
              加载更多主题
            </Link>
          ) : null}
        </section>

        <aside className="forum-rail" aria-label="社区信息">
          <section className="rail-panel">
            <div className="rail-panel__heading">
              <span className="rail-icon rail-icon--coral">
                <Flame aria-hidden="true" />
              </span>
              <h2>社区动态</h2>
            </div>
            <p className="rail-copy">
              CFBBS
              是一个开放的联邦社区。使用你的域名参与跨站讨论，也可以运行自己的节点。
            </p>
            <div className="rail-facts">
              <div>
                <strong>自主掌控身份</strong>
                <span>账号属于你自己的域名</span>
              </div>
              <div>
                <strong>跨站互动</strong>
                <span>关注并回复其他社区</span>
              </div>
              <div>
                <strong>开放互通</strong>
                <span>遵循 ActivityPub 标准</span>
              </div>
            </div>
          </section>
          <section className="rail-panel">
            <div className="rail-panel__heading">
              <span className="rail-icon rail-icon--green">
                <Flame aria-hidden="true" />
              </span>
              <h2>最近活动</h2>
            </div>
            <ul className="activity-list">
              {activity.map((topic, index) => (
                <li key={topic.id}>
                  <span
                    className={`activity-dot activity-dot--${index % 4}`}
                    aria-hidden="true"
                  />
                  <div>
                    <span>{topic.authorName} 发布了主题</span>
                    <Link to={`/threads/${topic.id}`}>{topic.title}</Link>
                  </div>
                </li>
              ))}
              {activity.length === 0 ? (
                <li className="rail-muted">暂无公开活动。</li>
              ) : null}
            </ul>
            <Link className="rail-link" to="/?sort=active">
              查看全部活动 <ChevronRight aria-hidden="true" />
            </Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
