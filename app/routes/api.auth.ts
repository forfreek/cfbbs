import type { Route } from "./+types/api.auth";

import { handleAuthRequest } from "@/modules/identity/auth.server";

export function loader({ request, context }: Route.LoaderArgs) {
  return handleAuthRequest(request, context.cloudflare.env);
}

export function action({ request, context }: Route.ActionArgs) {
  return handleAuthRequest(request, context.cloudflare.env);
}
