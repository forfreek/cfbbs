import { redirect } from "react-router";
import type { Route } from "./+types/auth.logout";
import { handleAuthRequest } from "@/modules/identity/auth.server";
export async function action({ request, context }: Route.ActionArgs) {
  const response = await handleAuthRequest(
    new Request(new URL("/api/auth/sign-out", request.url), {
      method: "POST",
      headers: request.headers,
    }),
    context.cloudflare.env,
  );
  return redirect("/", {
    headers: { "set-cookie": response.headers.get("set-cookie") ?? "" },
  });
}
