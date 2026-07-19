import { data, Form, redirect, useActionData } from "react-router";

import type { Route } from "./+types/admin.federation";
import {
  blockRemoteActor,
  listModeratableRemoteActors,
  unblockRemoteActor,
} from "@/modules/moderation/actor-block";
import { listAuditLogs } from "@/modules/moderation/audit";
import { listFederationDeliveryDiagnostics } from "@/modules/moderation/federation-diagnostics";
import {
  type InstancePolicyState,
  listInstancePolicies,
  setInstancePolicy,
} from "@/modules/moderation/instance-policy";
import { listReports, resolveReport } from "@/modules/moderation/reports";
import {
  clearRemoteActorQuarantine,
  listRemoteActorQuarantines,
} from "@/modules/moderation/remote-quarantine";
import { getSession } from "@/modules/identity/auth.server";
import { authorizeDatabase } from "@/modules/permissions/authorization.server";

async function administrationAccess(request: Request, env: Env) {
  const session = await getSession(request, env);
  if (!session) throw redirect("/auth/login");
  const [federation, reports, audit] = await Promise.all([
    authorizeDatabase(env.DB, {
      userId: session.user.id,
      permission: "federation.manage",
    }),
    authorizeDatabase(env.DB, {
      userId: session.user.id,
      permission: "reports.manage",
    }),
    authorizeDatabase(env.DB, {
      userId: session.user.id,
      permission: "audit.view",
    }),
  ]);
  if (!federation.allowed && !reports.allowed && !audit.allowed) {
    throw new Response("Forbidden", { status: 403 });
  }
  return {
    session,
    canManageFederation: federation.allowed,
    canManageReports: reports.allowed,
    canViewAudit: audit.allowed,
  };
}

function actionError(error: unknown) {
  return error instanceof Error ? error.message : "无法完成此操作。";
}

function isInstancePolicyState(value: string): value is InstancePolicyState {
  return value === "allowed" || value === "blocked" || value === "limited";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const access = await administrationAccess(request, context.cloudflare.env);
  const [policies, actors, quarantines, diagnostics, reports, auditLogs] =
    await Promise.all([
      access.canManageFederation
        ? listInstancePolicies(context.cloudflare.env.DB)
        : Promise.resolve({ results: [] }),
      access.canManageFederation
        ? listModeratableRemoteActors(context.cloudflare.env.DB)
        : Promise.resolve({ results: [] }),
      access.canManageFederation
        ? listRemoteActorQuarantines(context.cloudflare.env.DB)
        : Promise.resolve({ results: [] }),
      access.canManageFederation
        ? listFederationDeliveryDiagnostics(context.cloudflare.env.DB)
        : Promise.resolve({ results: [] }),
      access.canManageReports
        ? listReports(context.cloudflare.env.DB)
        : Promise.resolve({ results: [] }),
      access.canViewAudit
        ? listAuditLogs(context.cloudflare.env.DB)
        : Promise.resolve({ results: [] }),
    ]);
  return {
    ...access,
    policies: policies.results,
    actors: actors.results,
    quarantines: quarantines.results,
    diagnostics: diagnostics.results,
    reports: reports.results,
    auditLogs: auditLogs.results,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const access = await administrationAccess(request, context.cloudflare.env);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const actorUserId = access.session.user.id;

  try {
    if (intent === "set-instance-policy") {
      if (!access.canManageFederation) {
        throw new Response("Forbidden", { status: 403 });
      }
      const state = String(form.get("state") ?? "");
      if (!isInstancePolicyState(state)) {
        return data({ error: "实例策略状态无效。" }, { status: 400 });
      }
      await setInstancePolicy(context.cloudflare.env.DB, {
        id: crypto.randomUUID(),
        domain: String(form.get("domain") ?? ""),
        state,
        reason: String(form.get("reason") ?? ""),
        actorUserId,
      });
    } else if (intent === "block-actor" || intent === "unblock-actor") {
      if (!access.canManageFederation) {
        throw new Response("Forbidden", { status: 403 });
      }
      const input = {
        actorId: String(form.get("actorId") ?? ""),
        moderatorUserId: actorUserId,
        auditId: crypto.randomUUID(),
      };
      if (intent === "block-actor") {
        await blockRemoteActor(context.cloudflare.env.DB, input);
      } else {
        await unblockRemoteActor(context.cloudflare.env.DB, input);
      }
    } else if (intent === "clear-quarantine") {
      if (!access.canManageFederation) {
        throw new Response("Forbidden", { status: 403 });
      }
      await clearRemoteActorQuarantine(context.cloudflare.env.DB, {
        actorUri: String(form.get("actorUri") ?? ""),
        moderatorUserId: actorUserId,
        auditId: crypto.randomUUID(),
      });
    } else if (intent === "resolve-report" || intent === "dismiss-report") {
      if (!access.canManageReports) {
        throw new Response("Forbidden", { status: 403 });
      }
      await resolveReport(context.cloudflare.env.DB, {
        id: String(form.get("reportId") ?? ""),
        moderatorUserId: actorUserId,
        state: intent === "resolve-report" ? "resolved" : "dismissed",
        auditId: crypto.randomUUID(),
      });
    } else {
      return data({ error: "未知的审核操作。" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    return data({ error: actionError(error) }, { status: 400 });
  }

  return redirect("/admin/federation");
}

function timestamp(value: string | null) {
  return value ? value.slice(0, 16).replace("T", " ") : "—";
}

export default function FederationAdministration({
  loaderData,
}: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header>
        <p className="text-sm text-slate-500">管理</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">联邦审核</h1>
        <p className="mt-2 text-sm text-slate-600">
          实例与账号封禁会立刻阻止新的入站内容和未完成的定向投递。
        </p>
      </header>

      {actionData?.error ? (
        <p
          role="alert"
          className="mt-5 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {actionData.error}
        </p>
      ) : null}

      {loaderData.canManageFederation ? (
        <>
          <section className="mt-10 rounded-lg border p-5">
            <h2 className="text-lg font-semibold">实例策略</h2>
            <Form
              method="post"
              className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_auto]"
            >
              <input type="hidden" name="intent" value="set-instance-policy" />
              <label className="grid gap-1 text-sm">
                域名
                <input
                  name="domain"
                  required
                  placeholder="example.social"
                  className="rounded-md border px-3 py-2"
                />
              </label>
              <label className="grid gap-1 text-sm">
                策略
                <select
                  name="state"
                  defaultValue="blocked"
                  className="rounded-md border px-3 py-2"
                >
                  <option value="blocked">封禁</option>
                  <option value="limited">限制</option>
                  <option value="allowed">允许</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                原因
                <input
                  name="reason"
                  maxLength={2000}
                  className="rounded-md border px-3 py-2"
                />
              </label>
              <button className="self-end rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
                保存
              </button>
            </Form>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">域名</th>
                    <th className="py-2 pr-4">策略</th>
                    <th className="py-2 pr-4">原因</th>
                    <th className="py-2">更新</th>
                  </tr>
                </thead>
                <tbody>
                  {loaderData.policies.map((policy) => (
                    <tr key={policy.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{policy.domain}</td>
                      <td className="py-3 pr-4">{policy.state}</td>
                      <td className="py-3 pr-4 text-slate-600">
                        {policy.reason || "—"}
                      </td>
                      <td className="py-3 text-slate-500">
                        {timestamp(policy.updatedAt)}
                      </td>
                    </tr>
                  ))}
                  {loaderData.policies.length === 0 ? (
                    <tr>
                      <td className="py-4 text-slate-500" colSpan={4}>
                        尚未配置实例策略。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-6 rounded-lg border p-5">
            <h2 className="text-lg font-semibold">自动隔离</h2>
            <p className="mt-1 text-sm text-slate-600">
              异常速率或重复拒绝会触发 24 小时隔离；可在确认后提前解除。
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">账号</th>
                    <th className="py-2 pr-4">原因</th>
                    <th className="py-2 pr-4">到期</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loaderData.quarantines.map((quarantine) => (
                    <tr
                      key={quarantine.actorUri}
                      className="border-b last:border-0"
                    >
                      <td className="max-w-xs truncate py-3 pr-4">
                        {quarantine.actorUri}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {quarantine.reason}
                      </td>
                      <td className="py-3 pr-4 text-slate-500">
                        {timestamp(quarantine.expiresAt)}
                      </td>
                      <td className="py-3">
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="clear-quarantine"
                          />
                          <input
                            type="hidden"
                            name="actorUri"
                            value={quarantine.actorUri}
                          />
                          <button className="text-sm text-blue-700 hover:underline">
                            解除隔离
                          </button>
                        </Form>
                      </td>
                    </tr>
                  ))}
                  {loaderData.quarantines.length === 0 ? (
                    <tr>
                      <td className="py-4 text-slate-500" colSpan={4}>
                        当前没有自动隔离账号。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-6 rounded-lg border p-5">
            <h2 className="text-lg font-semibold">远端账号</h2>
            <p className="mt-1 text-sm text-slate-600">
              封禁会隐藏该账号已经写入本地主题的回复；解除封禁不会自动恢复它们。
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">账号</th>
                    <th className="py-2 pr-4">状态</th>
                    <th className="py-2 pr-4">最近更新</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loaderData.actors.map((actor) => (
                    <tr key={actor.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <span className="block font-medium">
                          {actor.name || actor.handle}
                        </span>
                        <a
                          className="text-xs text-blue-700 hover:underline"
                          href={actor.uri}
                        >
                          {actor.uri}
                        </a>
                      </td>
                      <td className="py-3 pr-4">
                        {actor.blockedAt ? "已封禁" : "正常"}
                      </td>
                      <td className="py-3 pr-4 text-slate-500">
                        {timestamp(actor.updatedAt)}
                      </td>
                      <td className="py-3">
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value={
                              actor.blockedAt ? "unblock-actor" : "block-actor"
                            }
                          />
                          <input
                            type="hidden"
                            name="actorId"
                            value={actor.id}
                          />
                          <button className="text-sm text-blue-700 hover:underline">
                            {actor.blockedAt ? "解除封禁" : "封禁"}
                          </button>
                        </Form>
                      </td>
                    </tr>
                  ))}
                  {loaderData.actors.length === 0 ? (
                    <tr>
                      <td className="py-4 text-slate-500" colSpan={4}>
                        尚未发现远端账号。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-6 rounded-lg border p-5">
            <h2 className="text-lg font-semibold">投递诊断</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">活动</th>
                    <th className="py-2 pr-4">状态</th>
                    <th className="py-2 pr-4">目标</th>
                    <th className="py-2">最近错误</th>
                  </tr>
                </thead>
                <tbody>
                  {loaderData.diagnostics.map((delivery) => (
                    <tr key={delivery.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <span className="font-medium">
                          {delivery.activityType}
                        </span>
                        <span className="ml-2 text-slate-500">
                          {delivery.aggregateType}
                        </span>
                      </td>
                      <td className="py-3 pr-4">{delivery.state}</td>
                      <td className="py-3 pr-4">
                        {delivery.targetCount}（待处理{" "}
                        {delivery.pendingCount ?? 0}，失败{" "}
                        {delivery.failedCount ?? 0}）
                      </td>
                      <td className="max-w-md py-3 text-slate-600">
                        {delivery.lastError || "—"}
                      </td>
                    </tr>
                  ))}
                  {loaderData.diagnostics.length === 0 ? (
                    <tr>
                      <td className="py-4 text-slate-500" colSpan={4}>
                        暂无投递记录。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {loaderData.canManageReports ? (
        <section className="mt-6 rounded-lg border p-5">
          <h2 className="text-lg font-semibold">待处理举报</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-slate-500">
                <tr>
                  <th className="py-2 pr-4">原因</th>
                  <th className="py-2 pr-4">帖子</th>
                  <th className="py-2 pr-4">时间</th>
                  <th className="py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {loaderData.reports.map((report) => (
                  <tr key={report.id} className="border-b last:border-0">
                    <td className="max-w-md py-3 pr-4">{report.reason}</td>
                    <td className="py-3 pr-4 font-mono text-xs">
                      {report.postId}
                    </td>
                    <td className="py-3 pr-4 text-slate-500">
                      {timestamp(report.createdAt)}
                    </td>
                    <td className="py-3">
                      <div className="flex gap-3">
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="resolve-report"
                          />
                          <input
                            type="hidden"
                            name="reportId"
                            value={report.id}
                          />
                          <button className="text-blue-700 hover:underline">
                            处理
                          </button>
                        </Form>
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="dismiss-report"
                          />
                          <input
                            type="hidden"
                            name="reportId"
                            value={report.id}
                          />
                          <button className="text-slate-600 hover:underline">
                            驳回
                          </button>
                        </Form>
                      </div>
                    </td>
                  </tr>
                ))}
                {loaderData.reports.length === 0 ? (
                  <tr>
                    <td className="py-4 text-slate-500" colSpan={4}>
                      暂无待处理举报。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {loaderData.canViewAudit ? (
        <section className="mt-6 rounded-lg border p-5">
          <h2 className="text-lg font-semibold">审计记录</h2>
          <ol className="mt-4 divide-y">
            <>
              {loaderData.auditLogs.map((entry) => (
                <li key={entry.id} className="py-3 text-sm">
                  <span className="font-medium">{entry.action}</span>
                  <span className="ml-2 text-slate-500">
                    {entry.targetType} · {entry.targetId} ·{" "}
                    {timestamp(entry.createdAt)}
                  </span>
                  <code className="mt-1 block text-xs break-all text-slate-500">
                    {entry.metadata}
                  </code>
                </li>
              ))}
            </>
            {loaderData.auditLogs.length === 0 ? (
              <li className="py-4 text-sm text-slate-500">暂无审计记录。</li>
            ) : null}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
