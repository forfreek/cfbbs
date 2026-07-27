import { useId, useState } from "react";
import { useFetcher } from "react-router";

import {
  maxAttachmentsPerPost,
  type MediaAttachmentView,
} from "@/modules/media";

type MarkdownPreviewResponse =
  | { ok: true; html: string }
  | { ok: false; message: string };

type MediaUploadResponse =
  | { ok: true; media: MediaAttachmentView }
  | { ok: false; message: string };

export function MarkdownEditor({
  defaultValue = "",
  label = "内容（Markdown）",
  rows = 8,
  initialAttachments = [],
  enableUpload = true,
}: {
  defaultValue?: string;
  label?: string;
  rows?: number;
  initialAttachments?: MediaAttachmentView[];
  enableUpload?: boolean;
}) {
  const editorId = useId();
  const [markdown, setMarkdown] = useState(defaultValue);
  const [attachments, setAttachments] =
    useState<MediaAttachmentView[]>(initialAttachments);
  const [showPreview, setShowPreview] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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

  async function onFileSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadError(null);
    const remaining = maxAttachmentsPerPost - attachments.length;
    if (remaining <= 0) {
      setUploadError(`每个帖子最多 ${maxAttachmentsPerPost} 个附件。`);
      return;
    }
    const files = Array.from(fileList).slice(0, remaining);
    setUploading(true);
    try {
      for (const file of files) {
        const body = new FormData();
        body.set("file", file);
        const response = await fetch("/api/media/upload", {
          method: "POST",
          body,
          credentials: "same-origin",
        });
        const payload = (await response.json()) as MediaUploadResponse;
        if (!payload.ok) {
          setUploadError(payload.message);
          break;
        }
        setAttachments((current) => {
          if (current.some((item) => item.id === payload.media.id)) {
            return current;
          }
          return [...current, payload.media];
        });
        if (payload.media.kind === "image") {
          setMarkdown(
            (current) =>
              `${current.trimEnd()}${current.trim() ? "\n\n" : ""}![${payload.media.originalFilename}](${payload.media.url})\n`,
          );
        }
      }
    } catch {
      setUploadError("上传失败，请稍后重试。");
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium" htmlFor={editorId}>
          {label}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {enableUpload ? (
            <label className="cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
              {uploading ? "上传中…" : "上传附件"}
              <input
                accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.zip,image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/zip"
                className="sr-only"
                disabled={uploading || attachments.length >= maxAttachmentsPerPost}
                multiple
                onChange={(event) => {
                  void onFileSelected(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
                type="file"
              />
            </label>
          ) : null}
          <button
            className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={requestPreview}
            type="button"
          >
            {preview.state !== "idle" ? "正在生成预览…" : "预览 Markdown"}
          </button>
        </div>
      </div>
      <textarea
        id={editorId}
        required
        name="markdown"
        maxLength={20_000}
        onChange={(event) => setMarkdown(event.currentTarget.value)}
        rows={rows}
        value={markdown}
        className="rounded-md border px-3 py-2 font-normal"
      />
      {attachments.map((attachment) => (
        <input
          key={attachment.id}
          type="hidden"
          name="attachmentIds"
          value={attachment.id}
        />
      ))}
      {uploadError ? (
        <p role="alert" className="text-sm text-red-700">
          {uploadError}
        </p>
      ) : null}
      {attachments.length > 0 ? (
        <ul className="space-y-2 rounded-md border bg-slate-50 p-3 text-sm">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <a
                className="text-blue-700 hover:underline"
                href={attachment.url}
                rel="nofollow ugc noopener"
                target="_blank"
              >
                {attachment.originalFilename}
              </a>
              <span className="text-xs text-slate-500">
                {attachment.kind} · {attachment.contentType}
              </span>
              <button
                className="text-xs text-slate-600 hover:text-red-700"
                onClick={() => removeAttachment(attachment.id)}
                type="button"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : enableUpload ? (
        <p className="text-xs text-slate-500">
          支持 jpeg/png/webp/gif/pdf/txt/zip，单文件 ≤ 5MB，每帖最多{" "}
          {maxAttachmentsPerPost} 个。图片会插入 Markdown，文档进入附件列表。
        </p>
      ) : null}
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
