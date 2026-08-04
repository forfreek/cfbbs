import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { AppShell } from "./components/app-shell";
import { getSession } from "./modules/identity/auth.server";
import { countUnreadNotifications } from "./modules/forum/notifications/read.server";
import {
  localeFromAcceptLanguage,
  type Locale,
  type Theme,
} from "./modules/i18n/messages";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  let session = null;
  try {
    session = await getSession(request, context.cloudflare.env);
  } catch (error) {
    // Public pages should still render in a fresh local dev environment before
    // the optional auth secret has been added.
    if (
      !(error instanceof Error) ||
      !error.message.includes("BETTER_AUTH_SECRET")
    ) {
      throw error;
    }
  }
  const unreadNotifications = session
    ? await countUnreadNotifications(context.cloudflare.env.DB, session.user.id)
    : 0;
  const cookie = request.headers.get("Cookie") ?? "";
  const localeCookie = cookie.match(/(?:^|;\s*)cfbbs\.locale=([^;]+)/)?.[1];
  const themeCookie = cookie.match(/(?:^|;\s*)cfbbs\.theme=([^;]+)/)?.[1];
  const locale: Locale =
    localeCookie === "en-US" || localeCookie === "zh-CN"
      ? localeCookie
      : localeFromAcceptLanguage(request.headers.get("Accept-Language"));
  const theme: Theme =
    themeCookie === "light" ||
    themeCookie === "dark" ||
    themeCookie === "system"
      ? themeCookie
      : "system";
  return { session, unreadNotifications, locale, theme };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <AppShell
      session={loaderData.session}
      unreadNotifications={loaderData.unreadNotifications}
      initialLocale={loaderData.locale}
      initialTheme={loaderData.theme}
    >
      <Outlet />
    </AppShell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
