import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";

import {
  maxAttachmentsPerPost,
  type MediaAttachmentView,
} from "@/modules/media/types";
import {
  clearLocalDraft,
  loadLocalDraft,
  saveLocalDraft,
  type LocalDraft,
} from "./draft-storage";
import { MediaGallery } from "./media-gallery";

type MarkdownPreviewResponse =
  { ok: true; html: string } | { ok: false; message: string };
type MediaUploadResponse =
  { ok: true; media: MediaAttachmentView } | { ok: false; message: string };

export function MarkdownEditor({
  defaultValue = "",
  label = "内容（Markdown）",
  rows = 8,
  initialAttachments = [],
  enableUpload = true,
  draftKey = null,
  draftTitle = "",
  onDraftTitleChange,
  serverUpdatedAt,
}: {
  defaultValue?: string;
  label?: string;
  rows?: number;
  initialAttachments?: MediaAttachmentView[];
  enableUpload?: boolean;
  draftKey?: string | null;
  draftTitle?: string;
  onDraftTitleChange?: (title: string) => void;
  serverUpdatedAt?: string;
}) {
  const editorId = useId();
  const [markdown, setMarkdown] = useState(defaultValue);
  const [attachments, setAttachments] =
    useState<MediaAttachmentView[]>(initialAttachments);
  const [showPreview, setShowPreview] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [draftReady, setDraftReady] = useState(!draftKey);
  const [draftConflict, setDraftConflict] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const draftSnapshot = useRef<Omit<LocalDraft, "version" | "savedAt">>({
    title: draftTitle,
    markdown: defaultValue,
    attachments: initialAttachments,
    serverUpdatedAt,
  });
  const preview = useFetcher<MarkdownPreviewResponse>();
  const previewError =
    preview.data && !preview.data.ok ? preview.data.message : null;
  const previewHtml =
    preview.data && preview.data.ok ? preview.data.html : null;

  useEffect(() => {
    const draft = loadLocalDraft(draftKey);
    if (draft) {
      const timer = window.setTimeout(() => {
        setDraftConflict(false);
        if (
          serverUpdatedAt &&
          draft.serverUpdatedAt &&
          draft.serverUpdatedAt !== serverUpdatedAt
        ) {
          setDraftConflict(true);
        }
        setMarkdown(draft.markdown);
        setAttachments(draft.attachments as MediaAttachmentView[]);
        onDraftTitleChange?.(draft.title);
        setDraftReady(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setDraftConflict(false);
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey, onDraftTitleChange, serverUpdatedAt]);

  useEffect(() => {
    if (!draftReady || !draftKey || typeof window === "undefined") return;
    const timer = window.setTimeout(
      () =>
        saveLocalDraft(draftKey, {
          title: draftTitle,
          markdown,
          attachments,
          serverUpdatedAt,
        }),
      750,
    );
    return () => window.clearTimeout(timer);
  }, [
    attachments,
    draftKey,
    draftReady,
    draftTitle,
    markdown,
    serverUpdatedAt,
  ]);

  useEffect(() => {
    draftSnapshot.current = {
      title: draftTitle,
      markdown,
      attachments,
      serverUpdatedAt,
    };
  }, [attachments, draftTitle, markdown, serverUpdatedAt]);

  const flushDraft = useCallback(() => {
    if (!draftReady || !draftKey) return;
    saveLocalDraft(draftKey, draftSnapshot.current);
  }, [draftKey, draftReady]);

  useEffect(() => {
    if (!draftKey || typeof window === "undefined") return;
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushDraft();
    };
    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("pagehide", flushDraft);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("pagehide", flushDraft);
    };
  }, [draftKey, flushDraft]);

  useEffect(() => {
    if (!draftKey || typeof document === "undefined") return;
    const textarea = document.getElementById(editorId);
    const form = textarea?.closest("form");
    if (!form) return;
    let cleanupTimer: number | null = null;
    const clearAfterSuccessfulSubmit = () => {
      if (cleanupTimer !== null) return;
      let checks = 0;
      cleanupTimer = window.setInterval(() => {
        checks += 1;
        // A failed action keeps the form mounted; a redirect removes it.
        if (!document.contains(form)) {
          clearLocalDraft(draftKey);
          if (cleanupTimer !== null) window.clearInterval(cleanupTimer);
          cleanupTimer = null;
        } else if (checks >= 100) {
          window.clearInterval(cleanupTimer);
          cleanupTimer = null;
        }
      }, 100);
    };
    form.addEventListener("submit", clearAfterSuccessfulSubmit);
    return () => {
      form.removeEventListener("submit", clearAfterSuccessfulSubmit);
    };
  }, [draftKey, editorId]);

  function requestPreview() {
    setShowPreview(true);
    preview.submit(
      { markdown },
      { method: "post", action: "/api/markdown-preview" },
    );
  }

  function uploadFile(file: File) {
    return new Promise<MediaAttachmentView>((resolve, reject) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      const body = new FormData();
      body.set("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/media/upload");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          setProgress((current) => ({
            ...current,
            [key]: Math.round((event.loaded / event.total) * 100),
          }));
      };
      xhr.onload = () => {
        try {
          const payload = JSON.parse(xhr.responseText) as MediaUploadResponse;
          if (xhr.status >= 200 && xhr.status < 300 && payload.ok)
            resolve(payload.media);
          else reject(new Error(payload.ok ? "上传失败。" : payload.message));
        } catch {
          reject(new Error("上传响应无效。"));
        }
      };
      xhr.onerror = () => reject(new Error("上传失败，请稍后重试。"));
      xhr.onloadend = () =>
        setProgress((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      xhr.send(body);
    });
  }

  async function onFileSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    setUploadError(null);
    const files = Array.from(fileList).slice(
      0,
      maxAttachmentsPerPost - attachments.length,
    );
    if (!files.length) {
      setUploadError(`每个帖子最多 ${maxAttachmentsPerPost} 个附件。`);
      return;
    }
    setUploading(true);
    const queue = [...files];
    const worker = async () => {
      while (queue.length) {
        const file = queue.shift();
        if (!file) return;
        try {
          const media = await uploadFile(file);
          setAttachments((current) =>
            current.some((item) => item.id === media.id)
              ? current
              : [...current, media],
          );
          if (media.kind === "image")
            setMarkdown(
              (current) =>
                `${current.trimEnd()}${current.trim() ? "\n\n" : ""}![${media.originalFilename}](${media.url})\n`,
            );
        } catch (error) {
          setUploadError(
            error instanceof Error ? error.message : "上传失败，请稍后重试。",
          );
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(2, files.length) }, () => worker()),
    );
    setUploading(false);
  }

  function reorderAttachment(from: number, to: number) {
    if (from === to) return;
    setAttachments((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  const progressValues = Object.values(progress);
  const totalProgress = progressValues.length
    ? Math.round(
        progressValues.reduce((sum, value) => sum + value, 0) /
          progressValues.length,
      )
    : 0;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium" htmlFor={editorId}>
          {label}
        </label>
        <div className="flex flex-wrap gap-2">
          {enableUpload ? (
            <label className="cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-slate-50">
              {uploading ? `上传中 ${totalProgress}%` : "上传附件"}
              <input
                className="sr-only"
                type="file"
                multiple
                disabled={
                  uploading || attachments.length >= maxAttachmentsPerPost
                }
                accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.zip,image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/zip"
                onChange={(event) => {
                  void onFileSelected(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          ) : null}
          <button
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
            type="button"
            onClick={requestPreview}
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
        rows={rows}
        value={markdown}
        onChange={(event) => setMarkdown(event.currentTarget.value)}
        className="rounded-md border px-3 py-2 font-normal"
      />
      {draftConflict ? (
        <p role="alert" className="text-sm text-amber-700">
          服务器上的内容在这份草稿保存后已更新，提交前请确认不会覆盖他人的修改。
        </p>
      ) : null}
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
      {attachments.length ? (
        <>
          <MediaGallery attachments={attachments} />
          <ul className="space-y-2 rounded-md border bg-slate-50 p-3 text-sm">
            {attachments.map((attachment, index) => (
              <li
                key={attachment.id}
                draggable
                onDragStart={() => {
                  dragIndex.current = index;
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragIndex.current !== null)
                    reorderAttachment(dragIndex.current, index);
                  dragIndex.current = null;
                }}
                className="flex flex-wrap items-center gap-2 rounded px-2 py-1 hover:bg-white"
              >
                <span className="cursor-grab text-slate-500">☷</span>
                <a
                  className="min-w-0 flex-1 truncate text-blue-700 hover:underline"
                  href={attachment.url}
                  target="_blank"
                  rel="nofollow ugc noopener"
                >
                  {attachment.originalFilename}
                </a>
                <span className="text-xs text-slate-500">
                  {attachment.kind} · {attachment.contentType}
                </span>
                <button
                  className="text-xs text-slate-600 hover:text-red-700"
                  type="button"
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : enableUpload ? (
        <p className="text-xs text-slate-500">
          支持 jpeg/png/webp/gif/pdf/txt/zip，单文件 ≤ 5MB，每帖最多{" "}
          {maxAttachmentsPerPost} 个附件。
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
          ) : (
            <article
              className="prose prose-slate mt-3 max-w-none"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
