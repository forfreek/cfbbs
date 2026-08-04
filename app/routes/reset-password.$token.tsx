import { redirect } from "react-router";

import type { Route } from "./+types/reset-password.$token";
import { handleAuthRequest } from "@/modules/identity/auth.server";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const target = new URL(
    `/api/auth/reset-password/${encodeURIComponent(params.token ?? "")}`,
    request.url,
  );
  target.searchParams.set(
    "callbackURL",
    `${context.cloudflare.env.APP_ORIGIN}/auth/reset`,
  );
  const response = await handleAuthRequest(
    new Request(target, {
      method: "GET",
      headers: { origin: context.cloudflare.env.APP_ORIGIN },
    }),
    context.cloudflare.env,
  );
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) throw redirect(location);
  }
  throw redirect(`/auth/reset?error=INVALID_TOKEN`);
}

export default function ResetPasswordTokenRoute() {
  return null;
}
