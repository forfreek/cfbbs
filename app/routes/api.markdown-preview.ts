import type { Route } from "./+types/api.markdown-preview";
import { renderMarkdownPreview } from "@/modules/forum/markdown/render";
import {
  consumeRateLimit,
  rateLimitResponse,
  rateLimitRules,
  requestIp,
} from "@/modules/rate-limit.server";

export async function action({ request, context }: Route.ActionArgs) {
  const limited = await consumeRateLimit(context.cloudflare.env.FEDIFY_KV, {
    scope: "preview",
    subject: requestIp(request),
    rule: rateLimitRules.preview,
  });
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const form = await request.formData();
  const preview = renderMarkdownPreview(form.get("markdown"));
  if (!preview.ok) {
    return Response.json(preview, { status: 400 });
  }
  return Response.json(preview);
}
