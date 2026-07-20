import type { Route } from "./+types/api.markdown-preview";
import { renderMarkdownPreview } from "@/modules/forum/markdown/render";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const preview = renderMarkdownPreview(form.get("markdown"));
  if (!preview.ok) {
    return Response.json(preview, { status: 400 });
  }
  return Response.json(preview);
}
