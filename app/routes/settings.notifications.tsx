import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/settings.notifications";
import {
  listThreadSubscriptions,
  setThreadSubscription,
  type ThreadSubscriptionMode,
} from "@/modules/forum/subscriptions";
import { getSession } from "@/modules/identity/auth.server";
import { PushSettings } from "@/components/push-settings";

async function loadPreferences(database: D1Database, userId: string) {
  return database
    .prepare(
      "SELECT push_replies AS pushReplies, push_mentions AS pushMentions, push_likes AS pushLikes, push_follows AS pushFollows, push_thread_replies AS pushThreadReplies FROM user_notification_preferences WHERE user_id = ? LIMIT 1",
    )
    .bind(userId)
    .first<Record<string, number>>();
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const [preferences, subscriptions] = await Promise.all([
    loadPreferences(context.cloudflare.env.DB, session.user.id),
    listThreadSubscriptions(context.cloudflare.env.DB, session.user.id),
  ]);
  return { preferences, subscriptions: subscriptions.results };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "subscription") {
    const modeValue = String(form.get("mode") ?? "");
    const mode: ThreadSubscriptionMode | null =
      modeValue === "all" || modeValue === "mentions" ? modeValue : null;
    await setThreadSubscription(context.cloudflare.env.DB, {
      userId: session.user.id,
      threadId: String(form.get("threadId") ?? ""),
      mode,
    });
    return redirect("/settings/notifications");
  }
  const now = new Date().toISOString();
  const bool = (name: string) => (form.get(name) === "on" ? 1 : 0);
  await context.cloudflare.env.DB.prepare(
    "INSERT INTO user_notification_preferences (user_id, push_replies, push_mentions, push_likes, push_follows, push_thread_replies, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET push_replies = excluded.push_replies, push_mentions = excluded.push_mentions, push_likes = excluded.push_likes, push_follows = excluded.push_follows, push_thread_replies = excluded.push_thread_replies, updated_at = excluded.updated_at",
  )
    .bind(
      session.user.id,
      bool("pushReplies"),
      bool("pushMentions"),
      bool("pushLikes"),
      bool("pushFollows"),
      bool("pushThreadReplies"),
      now,
      now,
    )
    .run();
  return redirect("/settings/notifications");
}

export default function NotificationSettings({
  loaderData,
}: Route.ComponentProps) {
  const preferences = loaderData.preferences;
  const checked = (key: string) => preferences?.[key] !== 0;
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">通知设置</h1>
      <p className="mt-2 text-sm text-slate-500">
        Web Push 需要在浏览器中主动授权；安全验证和密码邮件不受此设置影响。
      </p>
      <div className="mt-6">
        <PushSettings />
      </div>
      <Form method="post" className="mt-8 grid gap-3 rounded-lg border p-5">
        <label>
          <input
            type="checkbox"
            name="pushReplies"
            defaultChecked={checked("pushReplies")}
          />{" "}
          新回复
        </label>
        <label>
          <input
            type="checkbox"
            name="pushMentions"
            defaultChecked={checked("pushMentions")}
          />{" "}
          提及
        </label>
        <label>
          <input
            type="checkbox"
            name="pushLikes"
            defaultChecked={checked("pushLikes")}
          />{" "}
          点赞
        </label>
        <label>
          <input
            type="checkbox"
            name="pushFollows"
            defaultChecked={checked("pushFollows")}
          />{" "}
          关注
        </label>
        <label>
          <input
            type="checkbox"
            name="pushThreadReplies"
            defaultChecked={checked("pushThreadReplies")}
          />{" "}
          已订阅主题更新
        </label>
        <button className="w-fit rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50">
          保存设置
        </button>
      </Form>
      <h2 className="mt-10 text-xl font-semibold">主题订阅</h2>
      {loaderData.subscriptions.length > 0 ? (
        <ul className="mt-4 divide-y border-y">
          {loaderData.subscriptions.map((subscription) => (
            <li
              key={subscription.threadId}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <Link
                className="font-medium hover:text-blue-700"
                to={`/threads/${subscription.threadId}`}
              >
                {subscription.threadTitle}
              </Link>
              <Form method="post" className="flex items-center gap-2 text-sm">
                <input type="hidden" name="intent" value="subscription" />
                <input
                  type="hidden"
                  name="threadId"
                  value={subscription.threadId}
                />
                <select
                  name="mode"
                  defaultValue={subscription.mode}
                  className="rounded-md border px-2 py-1"
                >
                  <option value="all">全部回复</option>
                  <option value="mentions">仅被提及时</option>
                  <option value="none">取消订阅</option>
                </select>
                <button className="text-slate-600 hover:text-slate-950">
                  保存
                </button>
              </Form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-slate-500">暂无主题订阅。</p>
      )}
    </main>
  );
}
