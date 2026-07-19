import { Form, data, redirect, useActionData } from "react-router";
import { eq } from "drizzle-orm";

import type { Route } from "./+types/settings.profile";
import { createDatabase } from "@/db/client.server";
import { profiles } from "@/db/schema";
import { getSession } from "@/modules/identity/auth.server";
import { updateProfile } from "@/modules/identity/profile";

async function currentProfile(request: Request, env: Env) {
  const session = await getSession(request, env);
  if (!session) throw redirect("/auth/login");
  const profile = await createDatabase(env.DB).query.profiles.findFirst({
    where: eq(profiles.userId, session.user.id),
  });
  if (!profile) throw new Response("Profile missing", { status: 500 });
  return { session, profile };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  return currentProfile(request, context.cloudflare.env);
}
export async function action({ request, context }: Route.ActionArgs) {
  const { session } = await currentProfile(request, context.cloudflare.env);
  const form = await request.formData();
  const result = await updateProfile(
    context.cloudflare.env.DB,
    session.user.id,
    {
      displayName: String(form.get("displayName") ?? ""),
      bio: String(form.get("bio") ?? ""),
      avatarUrl: String(form.get("avatarUrl") ?? ""),
    },
  );
  if (!result.ok) return data({ error: result.message }, { status: 400 });
  return redirect(`/users/${session.user.username}`);
}

export default function SettingsProfile({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const { profile } = loaderData;
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Edit profile</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Your handle @{profile.handle} is permanent.
      </p>
      {actionData?.error && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {actionData.error}
        </p>
      )}
      <Form method="post" className="mt-6 grid gap-4">
        <label>
          Display name
          <input
            name="displayName"
            defaultValue={profile.displayName}
            required
            maxLength={80}
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <label>
          Biography
          <textarea
            name="bio"
            defaultValue={profile.bio}
            maxLength={2000}
            rows={6}
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <label>
          Avatar URL
          <input
            name="avatarUrl"
            type="url"
            defaultValue={profile.avatarUrl ?? ""}
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <button className="bg-primary text-primary-foreground rounded-md px-4 py-2">
          Save profile
        </button>
      </Form>
    </main>
  );
}
