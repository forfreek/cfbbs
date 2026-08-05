import Bell from "lucide-react/dist/esm/icons/bell.mjs";
import Menu from "lucide-react/dist/esm/icons/menu.mjs";
import PenLine from "lucide-react/dist/esm/icons/pen-line.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import { useEffect, useState } from "react";
import { Form, Link, useLocation } from "react-router";
import {
  getMessage,
  type Locale,
  type Theme,
  messages,
} from "@/modules/i18n/messages";

type Session = {
  user: {
    username?: string | null;
    name?: string | null;
  };
} | null;

export function AppShell({
  children,
  session,
  unreadNotifications = 0,
  initialLocale = "zh-CN",
  initialTheme = "system",
}: {
  children: React.ReactNode;
  session: Session;
  unreadNotifications?: number;
  initialLocale?: Locale;
  initialTheme?: Theme;
}) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    localStorage.setItem("cfbbs.locale", locale);
    document.cookie = `cfbbs.locale=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    localStorage.setItem("cfbbs.theme", theme);
    document.cookie = `cfbbs.theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const t = (key: keyof (typeof messages)["zh-CN"]) => getMessage(locale, key);
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
              {t("home")}
            </Link>
            <Link
              className="app-nav__link"
              aria-current={isActive("/following") ? "page" : undefined}
              to="/following"
            >
              {t("following")}
            </Link>
            <Link
              className="app-nav__link"
              aria-current={isActive("/search") ? "page" : undefined}
              to="/search"
            >
              {t("search")}
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
                  aria-label={t("notifications")}
                >
                  <Bell aria-hidden="true" />
                  {unreadNotifications > 0 ? (
                    <span
                      className="notification-badge"
                      aria-label={`${unreadNotifications} 条未读通知`}
                    >
                      {unreadNotifications > 99 ? "99+" : unreadNotifications}
                    </span>
                  ) : null}
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
                <Link className="text-button" to="/settings/notifications">
                  {t("notifications")}
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
            <label className="preference-select">
              <span className="sr-only">{t("language")}</span>
              <select
                aria-label={t("language")}
                value={locale}
                onChange={(event) =>
                  setLocale(event.currentTarget.value as Locale)
                }
              >
                <option value="zh-CN">中</option>
                <option value="en-US">EN</option>
              </select>
            </label>
            <label className="preference-select">
              <span className="sr-only">{t("theme")}</span>
              <select
                aria-label={t("theme")}
                value={theme}
                onChange={(event) =>
                  setTheme(event.currentTarget.value as Theme)
                }
              >
                <option value="system">{t("system")}</option>
                <option value="light">{t("light")}</option>
                <option value="dark">{t("dark")}</option>
              </select>
            </label>
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
            {t("home")}
          </Link>
          <Link
            aria-current={isActive("/following") ? "page" : undefined}
            onClick={() => setMobileOpen(false)}
            to="/following"
          >
            {t("following")}
          </Link>
          <Link
            aria-current={isActive("/search") ? "page" : undefined}
            onClick={() => setMobileOpen(false)}
            to="/search"
          >
            {t("search")}
          </Link>
          <Link onClick={() => setMobileOpen(false)} to="/notifications">
            {t("notifications")}
          </Link>
          {session ? (
            <>
              <Link
                onClick={() => setMobileOpen(false)}
                to="/settings/security"
              >
                安全
              </Link>
              <Form method="post" action="/auth/logout">
                <button type="submit">退出</button>
              </Form>
            </>
          ) : null}
        </nav>
      ) : null}
      <div className="app-shell__body">{children}</div>
    </div>
  );
}
