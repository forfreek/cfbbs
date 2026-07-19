import { data, Form, redirect, useActionData } from "react-router";

import type { Route } from "./+types/admin.groups";
import {
  addManagedGroupMember,
  createGroup,
  deleteGroup,
  isPermission,
  listGroupMembers,
  listGroupPermissions,
  listGroups,
  permissionKeys,
  removeManagedGroupMember,
  removeGroupPermission,
  setGroupPermission,
  updateGroup,
} from "@/modules/permissions/groups";
import { listManagedBoards } from "@/modules/forum/boards/service";
import { getSession } from "@/modules/identity/auth.server";
import { authorizeDatabase } from "@/modules/permissions/authorization.server";

async function groupAdministrationAccess(request: Request, env: Env) {
  const session = await getSession(request, env);
  if (!session) throw redirect("/auth/login");
  const decision = await authorizeDatabase(env.DB, {
    userId: session.user.id,
    permission: "groups.manage",
  });
  if (!decision.allowed) throw new Response("Forbidden", { status: 403 });
  return session;
}

function actionError(error: unknown) {
  return error instanceof Error ? error.message : "无法完成用户组操作。";
}

function optionalBoardId(value: FormDataEntryValue | null) {
  const boardId = String(value ?? "").trim();
  return boardId || null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await groupAdministrationAccess(request, context.cloudflare.env);
  const [groups, boards] = await Promise.all([
    listGroups(context.cloudflare.env.DB),
    listManagedBoards(context.cloudflare.env.DB),
  ]);
  const [grants, members] = await Promise.all([
    Promise.all(
      groups.results.map(async (group) => ({
        groupId: group.id,
        grants: (
          await listGroupPermissions(context.cloudflare.env.DB, group.id)
        ).results,
      })),
    ),
    Promise.all(
      groups.results.map(async (group) => ({
        groupId: group.id,
        members: (await listGroupMembers(context.cloudflare.env.DB, group.id))
          .results,
      })),
    ),
  ]);
  const grantsByGroup = new Map(
    grants.map((group) => [group.groupId, group.grants]),
  );
  const membersByGroup = new Map(
    members.map((group) => [group.groupId, group.members]),
  );
  return {
    groups: groups.results.map((group) => ({
      ...group,
      grants: grantsByGroup.get(group.id) ?? [],
      members: membersByGroup.get(group.id) ?? [],
    })),
    boards: boards.results,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await groupAdministrationAccess(
    request,
    context.cloudflare.env,
  );
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const audit = { actorUserId: session.user.id, auditId: crypto.randomUUID() };

  try {
    if (intent === "create") {
      await createGroup(context.cloudflare.env.DB, {
        ...audit,
        id: crypto.randomUUID(),
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
      });
    } else if (intent === "add-member" || intent === "remove-member") {
      const input = {
        ...audit,
        groupId: String(form.get("groupId") ?? ""),
        userId: String(form.get("userId") ?? ""),
      };
      if (intent === "add-member") {
        await addManagedGroupMember(context.cloudflare.env.DB, input);
      } else {
        await removeManagedGroupMember(context.cloudflare.env.DB, input);
      }
    } else if (intent === "update") {
      await updateGroup(context.cloudflare.env.DB, {
        ...audit,
        groupId: String(form.get("groupId") ?? ""),
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
      });
    } else if (intent === "set-permission" || intent === "remove-permission") {
      const permission = String(form.get("permission") ?? "");
      if (!isPermission(permission)) {
        return data({ error: "权限无效。" }, { status: 400 });
      }
      const input = {
        ...audit,
        groupId: String(form.get("groupId") ?? ""),
        permission,
        boardId: optionalBoardId(form.get("boardId")),
      };
      if (intent === "set-permission") {
        await setGroupPermission(context.cloudflare.env.DB, input);
      } else {
        await removeGroupPermission(context.cloudflare.env.DB, input);
      }
    } else if (intent === "delete") {
      await deleteGroup(context.cloudflare.env.DB, {
        ...audit,
        groupId: String(form.get("groupId") ?? ""),
      });
    } else {
      return data({ error: "未知的用户组操作。" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    return data({ error: actionError(error) }, { status: 400 });
  }
  return redirect("/admin/groups");
}

export default function GroupAdministration({
  loaderData,
}: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header>
        <p className="text-sm text-slate-500">管理</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">用户组</h1>
        <p className="mt-2 text-sm text-slate-600">
          授权采用允许规则的并集；板块范围会自动继承到其后代。
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

      <section className="mt-8 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">新建自定义用户组</h2>
        <Form method="post" className="mt-4 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="intent" value="create" />
          <label className="grid gap-1 text-sm">
            名称
            <input
              required
              name="name"
              maxLength={80}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            描述
            <input
              name="description"
              maxLength={2000}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <button className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            创建用户组
          </button>
        </Form>
      </section>

      <section className="mt-8 space-y-4">
        {loaderData.groups.map((group) => (
          <article key={group.id} className="rounded-lg border p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{group.name}</h2>
              <p className="text-xs text-slate-500">
                {group.isSystem ? "系统组" : "自定义组"} · {group.memberCount}{" "}
                名成员
              </p>
            </div>
            {group.description ? (
              <p className="mt-2 text-sm text-slate-600">{group.description}</p>
            ) : null}
            {!group.isSystem ? (
              <Form
                method="post"
                className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
              >
                <input type="hidden" name="intent" value="update" />
                <input type="hidden" name="groupId" value={group.id} />
                <input
                  required
                  name="name"
                  defaultValue={group.name}
                  maxLength={80}
                  aria-label="用户组名称"
                  className="rounded-md border px-2 py-1.5 text-sm"
                />
                <input
                  name="description"
                  defaultValue={group.description}
                  maxLength={2000}
                  aria-label="用户组描述"
                  className="rounded-md border px-2 py-1.5 text-sm"
                />
                <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50">
                  保存资料
                </button>
              </Form>
            ) : null}

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <section>
                <h3 className="font-medium">授权</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {group.grants.map((grant) => (
                    <li
                      key={`${grant.permission}:${grant.boardId ?? "site"}`}
                      className="flex items-center justify-between gap-3 rounded bg-slate-50 px-3 py-2"
                    >
                      <span>
                        {grant.permission}
                        {grant.boardId ? ` · ${grant.boardId}` : " · 全站"}
                      </span>
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="remove-permission"
                        />
                        <input type="hidden" name="groupId" value={group.id} />
                        <input
                          type="hidden"
                          name="permission"
                          value={grant.permission}
                        />
                        <input
                          type="hidden"
                          name="boardId"
                          value={grant.boardId ?? ""}
                        />
                        <button className="text-red-700 hover:underline">
                          移除
                        </button>
                      </Form>
                    </li>
                  ))}
                  {group.grants.length === 0 ? (
                    <li className="text-slate-500">尚无授权。</li>
                  ) : null}
                </ul>
                <Form method="post" className="mt-3 grid gap-2 sm:grid-cols-3">
                  <input type="hidden" name="intent" value="set-permission" />
                  <input type="hidden" name="groupId" value={group.id} />
                  <select
                    name="permission"
                    className="rounded-md border px-2 py-1.5 text-sm"
                  >
                    {permissionKeys.map((permission) => (
                      <option key={permission} value={permission}>
                        {permission}
                      </option>
                    ))}
                  </select>
                  <select
                    name="boardId"
                    className="rounded-md border px-2 py-1.5 text-sm"
                  >
                    <option value="">全站范围</option>
                    {loaderData.boards.map((board) => (
                      <option key={board.id} value={board.id}>
                        {board.title}
                      </option>
                    ))}
                  </select>
                  <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50">
                    添加授权
                  </button>
                </Form>
              </section>

              <section>
                <h3 className="font-medium">成员</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {group.members.map((member) => (
                    <li
                      key={member.userId}
                      className="flex items-center justify-between gap-3 rounded bg-slate-50 px-3 py-2"
                    >
                      <span>
                        {member.displayName ?? member.handle ?? member.userId}
                        {member.handle ? ` · @${member.handle}` : ""}
                      </span>
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="remove-member"
                        />
                        <input type="hidden" name="groupId" value={group.id} />
                        <input
                          type="hidden"
                          name="userId"
                          value={member.userId}
                        />
                        <button className="text-red-700 hover:underline">
                          移除
                        </button>
                      </Form>
                    </li>
                  ))}
                  {group.members.length === 0 ? (
                    <li className="text-slate-500">暂无成员。</li>
                  ) : null}
                </ul>
                <Form method="post" className="mt-3 flex gap-2">
                  <input type="hidden" name="intent" value="add-member" />
                  <input type="hidden" name="groupId" value={group.id} />
                  <input
                    required
                    name="userId"
                    placeholder="用户 ID"
                    className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm"
                  />
                  <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50">
                    添加成员
                  </button>
                </Form>
                <Form method="post" className="mt-2 flex gap-2">
                  <input type="hidden" name="intent" value="remove-member" />
                  <input type="hidden" name="groupId" value={group.id} />
                  <input
                    required
                    name="userId"
                    placeholder="用户 ID"
                    className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm"
                  />
                  <button className="rounded-md border px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                    移除成员
                  </button>
                </Form>
                {!group.isSystem ? (
                  <Form method="post" className="mt-5">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="groupId" value={group.id} />
                    <button className="text-sm text-red-700 hover:underline">
                      删除用户组
                    </button>
                  </Form>
                ) : null}
              </section>
            </div>
          </article>
        ))}
        {loaderData.groups.length === 0 ? (
          <p className="text-sm text-slate-500">尚无用户组。</p>
        ) : null}
      </section>
    </main>
  );
}
