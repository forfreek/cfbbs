import Bell from "lucide-react/dist/esm/icons/bell.mjs";
import Menu from "lucide-react/dist/esm/icons/menu.mjs";
import PenLine from "lucide-react/dist/esm/icons/pen-line.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import { useState } from "react";
import { Form, Link, useLocation } from "react-router";

type Session = {
  user: {
    username?: string | null;
    name?: string | null;
  };
} | null;

export function AppShell({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session;
}) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const handle = session?.user.username ?? session?.user.name ?? "我的账号";
  const isActive = (href: string) =>
    href === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(href);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="app-header">
        <div className="app-header__inner">
          <Link className="brand" to="/" aria-label="CFBBS 首页">
            <span className="brand__mark" aria-hidden="true">
              C
            </span>
            <span className="brand__name">CFBBS</span>
          </Link>

          <nav className="app-nav" aria-label="主导航">
            <Link
              className="app-nav__link"
              aria-current={isActive("/") ? "page" : undefined}
              to="/"
            >
              首页
            </Link>
            <Link
              className="app-nav__link"
              aria-current={isActive("/following") ? "page" : undefined}
              to="/following"
            >
              关注
            </Link>
            <Link
              className="app-nav__link"
              aria-current={isActive("/search") ? "page" : undefined}
              to="/search"
            >
              搜索
            </Link>
          </nav>

          <div className="app-header__actions">
            <button
              className="icon-button app-mobile-menu"
              type="button"
              aria-label="打开导航"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((value) => !value)}
            >
              <Menu aria-hidden="true" />
            </button>
            <Link className="icon-button" to="/search" aria-label="搜索">
              <Search aria-hidden="true" />
            </Link>
            {session ? (
              <>
                <Link
                  className="icon-button app-notification"
                  to="/notifications"
                  aria-label="通知"
                >
                  <Bell aria-hidden="true" />
                </Link>
                <Link className="user-menu" to={`/users/${handle}`}>
                  <span className="avatar avatar--small" aria-hidden="true">
                    {handle.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="user-menu__name">{handle}</span>
                </Link>
                <Link className="text-button" to="/settings/security">
                  安全
                </Link>
                <Form method="post" action="/auth/logout">
                  <button className="text-button" type="submit">
                    退出
                  </button>
                </Form>
              </>
            ) : (
              <>
                <Link className="text-button app-sign-in" to="/auth/login">
                  登录
                </Link>
                <Link
                  className="primary-button primary-button--small"
                  to="/auth/register"
                >
                  <PenLine aria-hidden="true" />
                  注册
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      {mobileOpen ? (
        <nav className="app-mobile-panel" aria-label="移动端导航">
          <Link
            aria-current={isActive("/") ? "page" : undefined}
            onClick={() => setMobileOpen(false)}
            to="/"
          >
            首页
          </Link>
          <Link
            aria-current={isActive("/following") ? "page" : undefined}
            onClick={() => setMobileOpen(false)}
            to="/following"
          >
            关注
          </Link>
          <Link
            aria-current={isActive("/search") ? "page" : undefined}
            onClick={() => setMobileOpen(false)}
            to="/search"
          >
            搜索
          </Link>
          <Link onClick={() => setMobileOpen(false)} to="/notifications">
            通知
          </Link>
        </nav>
      ) : null}
      <div className="app-shell__body">{children}</div>
    </div>
  );
}
