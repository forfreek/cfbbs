import { Form, Link, data, redirect, useActionData } from "react-router";

import type { Route } from "./+types/auth.register";
import { handleAuthRequest } from "@/modules/identity/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const response = await handleAuthRequest(
    new Request(new URL("/api/auth/sign-up/email", request.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: context.cloudflare.env.APP_ORIGIN,
      },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        username: form.get("username"),
        password: form.get("password"),
      }),
    }),
    context.cloudflare.env,
  );
  const payload = (await response.json()) as {
    user?: { username?: string };
    message?: string;
  };
  if (!response.ok || !payload.user?.username)
    return data(
      { error: payload.message ?? "Registration failed." },
      { status: response.status },
    );
  return redirect(`/users/${payload.user.username}`, {
    headers: { "set-cookie": response.headers.get("set-cookie") ?? "" },
  });
}

export default function Register() {
  const actionData = useActionData<typeof action>();
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Create your CFBBS account</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Your lowercase handle becomes your permanent federation identity.
      </p>
      {actionData?.error && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {actionData.error}
        </p>
      )}
      <Form method="post" className="mt-6 grid gap-4">
        <label>
          Name
          <input
            required
            name="name"
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <label>
          Email
          <input
            required
            name="email"
            type="email"
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <label>
          Handle
          <input
            required
            name="username"
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_]+"
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <label>
          Password
          <input
            required
            name="password"
            type="password"
            minLength={12}
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <button className="bg-primary text-primary-foreground rounded-md px-4 py-2">
          Create account
        </button>
      </Form>
      <p className="mt-5 text-sm">
        Already registered?{" "}
        <Link className="underline" to="/auth/login">
          Sign in
        </Link>
      </p>
    </main>
  );
}
