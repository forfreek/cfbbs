import { data, Form, redirect, useActionData } from "react-router";

import type { Route } from "./+types/admin.boards";
import {
  createBoard,
  isBoardMode,
  isBoardVisibility,
  listManagedBoards,
  moveBoard,
  setBoardMode,
  setBoardSortOrder,
  setBoardVisibility,
} from "@/modules/forum/boards/service";
import { getSession } from "@/modules/identity/auth.server";
import { authorizeDatabase } from "@/modules/permissions/authorization.server";

const modes = ["container", "posting", "read_only"] as const;
const visibilities = ["public", "private"] as const;

async function boardAdministrationAccess(request: Request, env: Env) {
  const session = await getSession(request, env);
  if (!session) throw redirect("/auth/login");
  const decision = await authorizeDatabase(env.DB, {
    userId: session.user.id,
    permission: "boards.manage",
  });
  if (!decision.allowed) throw new Response("Forbidden", { status: 403 });
  return session;
}

function actionError(error: unknown) {
  return error instanceof Error ? error.message : "无法完成板块操作。";
}

function optionalParentId(value: FormDataEntryValue | null) {
  const parentId = String(value ?? "").trim();
  return parentId || null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await boardAdministrationAccess(request, context.cloudflare.env);
  const boards = await listManagedBoards(context.cloudflare.env.DB);
  return { boards: boards.results };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await boardAdministrationAccess(
    request,
    context.cloudflare.env,
  );
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const audit = { actorUserId: session.user.id, auditId: crypto.randomUUID() };

  try {
    if (intent === "create") {
      const mode = String(form.get("mode") ?? "");
      const visibility = String(form.get("visibility") ?? "");
      if (!isBoardMode(mode) || !isBoardVisibility(visibility)) {
        return data({ error: "板块模式或可见性无效。" }, { status: 400 });
      }
      const sortOrder = Number(form.get("sortOrder") ?? 0);
      await createBoard(context.cloudflare.env.DB, {
        ...audit,
        id: crypto.randomUUID(),
        parentId: optionalParentId(form.get("parentId")),
        slug: String(form.get("slug") ?? ""),
        title: String(form.get("title") ?? ""),
        description: String(form.get("description") ?? ""),
        mode,
        visibility,
        sortOrder,
      });
    } else if (intent === "move") {
      await moveBoard(context.cloudflare.env.DB, {
        ...audit,
        boardId: String(form.get("boardId") ?? ""),
        newParentId: optionalParentId(form.get("parentId")),
      });
    } else if (intent === "set-mode") {
      const mode = String(form.get("mode") ?? "");
      if (!isBoardMode(mode)) {
        return data({ error: "板块模式无效。" }, { status: 400 });
      }
      await setBoardMode(context.cloudflare.env.DB, {
        ...audit,
        boardId: String(form.get("boardId") ?? ""),
        mode,
      });
    } else if (intent === "set-visibility") {
      const visibility = String(form.get("visibility") ?? "");
      if (!isBoardVisibility(visibility)) {
        return data({ error: "板块可见性无效。" }, { status: 400 });
      }
      await setBoardVisibility(context.cloudflare.env.DB, {
        ...audit,
        boardId: String(form.get("boardId") ?? ""),
        visibility,
      });
    } else if (intent === "set-sort-order") {
      await setBoardSortOrder(context.cloudflare.env.DB, {
        ...audit,
        boardId: String(form.get("boardId") ?? ""),
        sortOrder: Number(form.get("sortOrder")),
      });
    } else {
      return data({ error: "未知的板块操作。" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    return data({ error: actionError(error) }, { status: 400 });
  }
  return redirect("/admin/boards");
}

export default function BoardAdministration({
  loaderData,
}: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const { boards } = loaderData;
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header>
        <p className="text-sm text-slate-500">管理</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">板块</h1>
        <p className="mt-2 text-sm text-slate-600">
          私有板块及其后代不会进入公开搜索或联邦投递。
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
        <h2 className="text-lg font-semibold">新建板块</h2>
        <Form method="post" className="mt-4 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="intent" value="create" />
          <label className="grid gap-1 text-sm">
            标题
            <input
              required
              name="title"
              maxLength={120}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Slug
            <input
              required
              name="slug"
              pattern="[a-z0-9][a-z0-9-]{0,62}"
              maxLength={63}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            父板块
            <select name="parentId" className="rounded-md border px-3 py-2">
              <option value="">顶层板块</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.title}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            排序
            <input
              defaultValue={0}
              name="sortOrder"
              type="number"
              step={1}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            模式
            <select
              name="mode"
              defaultValue="posting"
              className="rounded-md border px-3 py-2"
            >
              {modes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            可见性
            <select
              name="visibility"
              defaultValue="public"
              className="rounded-md border px-3 py-2"
            >
              {visibilities.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {visibility}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">
            描述
            <textarea
              name="description"
              maxLength={2000}
              rows={3}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <button className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            创建板块
          </button>
        </Form>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">现有板块</h2>
        {boards.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {boards.map((board) => (
              <li key={board.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{board.title}</h3>
                  <p className="text-xs text-slate-500">{board.slug}</p>
                </div>
                <div className="mt-4 grid gap-3 text-sm lg:grid-cols-4">
                  <Form method="post" className="grid gap-1">
                    <input type="hidden" name="intent" value="move" />
                    <input type="hidden" name="boardId" value={board.id} />
                    <label>父板块</label>
                    <select
                      name="parentId"
                      defaultValue={board.parentId ?? ""}
                      className="rounded-md border px-2 py-1.5"
                    >
                      <option value="">顶层板块</option>
                      {boards.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.title}
                        </option>
                      ))}
                    </select>
                    <button className="text-left text-blue-700 hover:underline">
                      保存位置
                    </button>
                  </Form>
                  <Form method="post" className="grid gap-1">
                    <input type="hidden" name="intent" value="set-mode" />
                    <input type="hidden" name="boardId" value={board.id} />
                    <label>模式</label>
                    <select
                      name="mode"
                      defaultValue={board.mode}
                      className="rounded-md border px-2 py-1.5"
                    >
                      {modes.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                    <button className="text-left text-blue-700 hover:underline">
                      保存模式
                    </button>
                  </Form>
                  <Form method="post" className="grid gap-1">
                    <input type="hidden" name="intent" value="set-visibility" />
                    <input type="hidden" name="boardId" value={board.id} />
                    <label>可见性</label>
                    <select
                      name="visibility"
                      defaultValue={board.visibility}
                      className="rounded-md border px-2 py-1.5"
                    >
                      {visibilities.map((visibility) => (
                        <option key={visibility} value={visibility}>
                          {visibility}
                        </option>
                      ))}
                    </select>
                    <button className="text-left text-blue-700 hover:underline">
                      保存可见性
                    </button>
                  </Form>
                  <Form method="post" className="grid gap-1">
                    <input type="hidden" name="intent" value="set-sort-order" />
                    <input type="hidden" name="boardId" value={board.id} />
                    <label>排序</label>
                    <input
                      defaultValue={board.sortOrder}
                      name="sortOrder"
                      type="number"
                      step={1}
                      className="rounded-md border px-2 py-1.5"
                    />
                    <button className="text-left text-blue-700 hover:underline">
                      保存排序
                    </button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-500">尚无板块。</p>
        )}
      </section>
    </main>
  );
}
