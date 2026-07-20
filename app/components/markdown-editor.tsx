import { useState } from "react";
import { useFetcher } from "react-router";

type MarkdownPreviewResponse =
  { ok: true; html: string } | { ok: false; message: string };

export function MarkdownEditor({
  defaultValue = "",
  label = "内容（Markdown）",
  rows = 8,
}: {
  defaultValue?: string;
  label?: string;
  rows?: number;
}) {
  const [markdown, setMarkdown] = useState(defaultValue);
  const [showPreview, setShowPreview] = useState(false);
  const preview = useFetcher<MarkdownPreviewResponse>();
  const previewError =
    preview.data && !preview.data.ok ? preview.data.message : null;
  const previewHtml =
    preview.data && preview.data.ok ? preview.data.html : null;

  function requestPreview() {
    setShowPreview(true);
    preview.submit(
      { markdown },
      { method: "post", action: "/api/markdown-preview" },
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium" htmlFor="markdown-editor">
          {label}
        </label>
        <button
          className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          onClick={requestPreview}
          type="button"
        >
          {preview.state !== "idle" ? "正在生成预览…" : "预览 Markdown"}
        </button>
      </div>
      <textarea
        id="markdown-editor"
        required
        name="markdown"
        maxLength={20_000}
        onChange={(event) => setMarkdown(event.currentTarget.value)}
        rows={rows}
        value={markdown}
        className="rounded-md border px-3 py-2 font-normal"
      />
      {showPreview ? (
        <section
          aria-live="polite"
          aria-label="Markdown 预览"
          className="rounded-md border bg-slate-50 p-4"
        >
          <h3 className="text-sm font-semibold">预览</h3>
          {previewError ? (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {previewError}
            </p>
          ) : previewHtml === null ? (
            <p className="mt-3 text-sm text-slate-500">正在生成预览…</p>
          ) : previewHtml ? (
            <article
              className="prose prose-slate mt-3 max-w-none"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <p className="mt-3 text-sm text-slate-500">预览为空。</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
