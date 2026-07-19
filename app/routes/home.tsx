import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Folder,
  Home as HomeIcon,
  PenLine,
  Search,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";

const topics = [
  ["CFBBS v0.5.0 发布：联邦身份与跨站关注", "cloudsailor", "12", "23 分钟前"],
  [
    "如何为 Cloudflare Workers 选择合适的存储方案？",
    "wintermute",
    "8",
    "1 小时前",
  ],
  ["在 Workers 上实现 Server-Sent Events 的实践", "imnks", "6", "2 小时前"],
  ["D1 事务与一致性：一些实战经验", "karaage", "4", "3 小时前"],
  ["使用 Hono + Workers 搭建 REST API 的一些心得", "echozy", "3", "4 小时前"],
  ["关于联邦关注：设计思路与实现细节", "subsquid", "15", "5 小时前"],
  ["前端资源加载优化：一些可落地的方案", "lucas", "7", "6 小时前"],
  ["将旧论坛数据导入 CFBBS 的工具脚本分享", "saturnian", "2", "8 小时前"],
];

const activity = [
  "cloudsailor 发布了主题",
  "wintermute 回复了主题",
  "imnks 发布了主题",
  "subsquid 回复了主题",
  "lucas 回复了主题",
];

function BoardGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="mt-5">
      <h2 className="flex items-center gap-1 text-sm font-semibold">
        <ChevronDown className="size-3.5" />
        {title}
      </h2>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item}>
            <Link
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
              to="/"
            >
              <Folder className="size-3.5" />
              {item}
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

export default function Home() {
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
            <Link className="text-slate-600 hover:text-slate-950" to="/">
              Following
            </Link>
            <Link
              className="flex items-center gap-1.5 text-slate-600 hover:text-slate-950"
              to="/"
            >
              <Search className="size-4" />
              Search
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <Link className="hidden sm:block" to="/auth/login">
              Sign in
            </Link>
            <Link
              className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white shadow-sm hover:bg-blue-700"
              to="/auth/register"
            >
              Create account
            </Link>
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
              to="/"
            >
              <CircleDot className="size-4" />
              我的关注
            </Link>
            <Link
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-600 hover:bg-slate-50"
              to="/"
            >
              <Sparkles className="size-4" />
              热门主题
            </Link>
          </nav>
          <div className="my-5 border-t" />
          <h2 className="px-2 text-sm font-semibold">板块导航</h2>
          <BoardGroup
            title="CFBBS"
            items={["公告", "反馈与建议", "开发者交流", "产品与设计"]}
          />
          <BoardGroup
            title="技术与讨论"
            items={["编程语言", "前端开发", "后端开发", "基础设施", "开源项目"]}
          />
          <BoardGroup
            title="生活与兴趣"
            items={["生活分享", "摄影与旅行", "阅读与写作", "音乐与电影"]}
          />
        </aside>
        <section className="min-w-0 px-7 py-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">全部主题</h1>
            <Link
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
              to="/auth/register"
            >
              <PenLine className="size-4" />
              发布主题
            </Link>
          </div>
          <div className="mt-7 flex gap-6 border-b text-sm">
            <button className="border-b-2 border-blue-600 pb-3 font-medium text-blue-700">
              最新
            </button>
            <button className="pb-3 text-slate-500">活跃</button>
            <button className="pb-3 text-slate-500">未回复</button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_80px_44px_80px] gap-3 border-b py-3 text-xs font-medium text-slate-500">
            <span>主题</span>
            <span>作者</span>
            <span>回复</span>
            <span>时间</span>
          </div>
          <div>
            {topics.map(([title, author, replies, time], index) => (
              <article
                key={title}
                className="grid grid-cols-[minmax(0,1fr)_80px_44px_80px] gap-3 border-b py-4 text-sm"
              >
                <Link
                  className="truncate font-medium hover:text-blue-700"
                  to="/"
                >
                  {title}
                  {index === 0 || index === 4 ? (
                    <span className="ml-2 inline-block size-1.5 rounded-full bg-blue-600 align-middle" />
                  ) : null}
                </Link>
                <span className="truncate text-slate-500">{author}</span>
                <span className="text-slate-500">{replies}</span>
                <span className="text-right text-slate-500">{time}</span>
              </article>
            ))}
          </div>
          <button className="mt-5 flex w-full items-center justify-center gap-2 rounded-md border py-2.5 text-sm text-slate-500 hover:bg-slate-50">
            加载更多主题 <ChevronDown className="size-4" />
          </button>
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
              {activity.map((line, index) => (
                <li key={line} className="flex gap-2 text-sm">
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
                    <span className="text-slate-600">{line}</span>
                    <br />
                    <Link
                      className="line-clamp-1 text-blue-700 hover:underline"
                      to="/"
                    >
                      联邦身份与跨站关注的讨论
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
            <Link
              className="mt-5 flex items-center gap-1 text-sm font-medium text-blue-700"
              to="/"
            >
              查看全部活动 <ChevronRight className="size-4" />
            </Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
